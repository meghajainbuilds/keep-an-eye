import http from 'node:http';
import { captureDiagnostic } from './lib/capture-diagnostic.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.mjs';
import { cleanUrl, inspectProduct } from './lib/product.mjs';
import { checkPrices } from './lib/alerts.mjs';
import { askShoppingAssistant } from './lib/assistant.mjs';
import { CATEGORIES, categorizeProduct, guessCategory, validCategory } from './lib/categories.mjs';
import { sendPushAlert, validSubscription } from './lib/push.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const password = process.env.APP_PASSWORD;
const secret = process.env.SESSION_SECRET;
const cronSecret = process.env.CRON_SECRET;
const pushPublicKey = process.env.VAPID_PUBLIC_KEY;
const pushPrivateKey = process.env.VAPID_PRIVATE_KEY;
const pushSubject = process.env.VAPID_SUBJECT;
const pushReady = Boolean(pushPublicKey && pushPrivateKey && pushSubject);
if (!password || password.length < 12 || !secret || secret.length < 32 || !cronSecret || cronSecret.length < 32 ||
    secret === cronSecret || [password, secret, cronSecret].some(value => value.startsWith('replace-with-'))) {
  console.error('Set a private APP_PASSWORD (at least 12 characters) and distinct SESSION_SECRET/CRON_SECRET values (at least 32 characters). Replace all example placeholders.');
  process.exit(1);
}
const store = createStore(process.env.DATA_DIR || join(root, 'data'));
const limit = new Map();
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
const sign = value => createHmac('sha256', secret).update(value).digest('hex');
const validSession = req => {
  const value = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!value) return false;
  const [expires, mac] = value.split('.');
  return /^\d+$/.test(expires || '') && Number(expires) > Date.now() && equal(mac, sign(expires));
};
function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data.error ? { ...data, message: data.error } : data));
}
async function body(req) {
  let text = '';
  for await (const part of req) {
    text += part;
    if (text.length > 12_000) throw new Error('Request too large.');
  }
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON.'); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host && ['https:', 'http:'].includes(new URL(origin).protocol); }
  catch { return false; }
}
function safeText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function target(value) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value.trim()))) throw new Error('Enter a valid target price.');
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 999_999) throw new Error('Enter a positive target price.');
  return Math.round(n * 100) / 100;
}
function discount(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('Enter a discount from 1% to 90%.');
  return Math.round(n);
}
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']]
]);

async function saveFind(input) {
  const url = cleanUrl(input.url);
  const existing = store.byUrl(url);
  if (existing) return { item: existing, existing: true };
  let details = {}, warning = null;
  try { details = await inspectProduct(url); }
  catch { warning = 'Saved the link. The store did not provide product details, so add a title and check prices manually.'; }
  const title = safeText(input.title, 180) || details.title || new URL(url).hostname;
  const note = safeText(input.note, 500);
  const classification = await categorizeProduct({ url, title, description: details.description, note },
    process.env.OPENAI_API_KEY, process.env.OPENAI_CATEGORIZATION_MODEL);
  // Another request may have saved this URL while enrichment was running.
  const raced = store.byUrl(url);
  if (raced) return { item: raced, existing: true };
  const item = store.add({ url, ...details, title, note, ...classification,
    watch_enabled: input.watch_enabled !== false,
    target_price: target(input.target_price), discount_percent: discount(input.discount_percent) ?? 20 });
  return { item, warning };
}

export const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (req.method === 'POST' && path === '/api/capture') {
      const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      const savedHash = store.getSetting('shortcut_token_hash');
      if (!supplied || !savedHash || !equal(tokenHash(supplied), savedHash))
        return json(res, 401, { error: 'Shortcut key is missing or disabled. Open Keep an Eye to set it up again.' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid origin.' });
      const input = await body(req);
      // Save-only access: no notes, watch mutations, or collection data returned.
      let url;
      try { url = cleanUrl(input?.url); }
      catch (error) {
        store.setSetting('capture_diagnostic', JSON.stringify({
          at: new Date().toISOString(), status: 'rejected', ...captureDiagnostic(input?.url)
        }));
        return json(res, 400, { error: 'This shared link could not be read. A diagnostic has been recorded in Keep an Eye; no Shortcut changes are needed.' });
      }
      const result = await saveFind({ url });
      store.setSetting('capture_diagnostic', JSON.stringify({ at: new Date().toISOString(), status: 'accepted', ...captureDiagnostic(input?.url) }));
      store.setSetting('saving_setup_complete', '1');
      return json(res, result.existing ? 200 : 201, {
        message: result.existing ? 'Already saved to Keep an Eye.' :
          result.warning ? 'Saved to Keep an Eye. Product details were unavailable; you can edit them later.' : 'Saved to Keep an Eye.'
      });
    }
    if (req.method === 'POST' && path === '/api/check-prices') {
      if (!cronSecret || !equal(req.headers.authorization || '', `Bearer ${cronSecret}`)) return json(res, 401, { error: 'Unauthorized.' });
      const result = await checkPrices(store, { notify: pushReady ? ({ item, price }) =>
        sendPushAlert(store, { item, price, publicKey: pushPublicKey, privateKey: pushPrivateKey, subject: pushSubject }) : null });
      return json(res, 200, result);
    }
    if (req.method === 'POST' && path === '/api/login') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid origin.' });
      const ip = req.socket.remoteAddress || 'unknown';
      const tries = limit.get(ip) || { count: 0, until: 0 };
      if (tries.until > Date.now()) return json(res, 429, { error: 'Try again in a few minutes.' });
      const input = await body(req);
      if (!equal(input.password || '', password)) {
        tries.count += 1;
        if (tries.count >= 5) { tries.until = Date.now() + 15 * 60_000; tries.count = 0; }
        limit.set(ip, tries);
        return json(res, 401, { error: 'Incorrect password.' });
      }
      limit.delete(ip);
      const expires = String(Date.now() + 30 * 24 * 60 * 60_000);
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
      return json(res, 200, { ok: true }, { 'set-cookie': `session=${expires}.${sign(expires)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` });
    }
    if (req.method === 'POST' && path === '/api/logout') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid origin.' });
      return json(res, 200, { ok: true }, { 'set-cookie': 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (path.startsWith('/api/')) {
      if (!validSession(req)) return json(res, 401, { error: 'Sign in to see your saved items.' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid origin.' });
      if (req.method === 'GET' && path === '/api/capture-diagnostic') {
        const saved = store.getSetting('capture_diagnostic');
        const diagnostic = saved ? JSON.parse(saved) : null;
        return json(res, 200, { diagnostic: diagnostic && Date.now() - Date.parse(diagnostic.at) < 86400000 ? diagnostic : null });
      }
      if (path === '/api/shortcut-token') {
        if (req.method === 'GET') return json(res, 200, { enabled: Boolean(store.getSetting('shortcut_token_hash')) });
        if (req.method === 'POST') {
          const token = randomBytes(32).toString('base64url');
          store.setSetting('shortcut_token_hash', tokenHash(token));
          return json(res, 201, { token });
        }
        if (req.method === 'DELETE') {
          store.setSetting('shortcut_token_hash', '');
          return json(res, 200, { ok: true });
        }
      }
      if (req.method === 'GET' && path === '/api/config') return json(res, 200, {
        assistant: Boolean(process.env.OPENAI_API_KEY), categories: CATEGORIES,
        savingSetupComplete: store.getSetting('saving_setup_complete') === '1',
        alerts: pushReady, pushPublicKey: pushReady ? pushPublicKey : null
      });
      if (req.method === 'POST' && path === '/api/saving-setup') {
        store.setSetting('saving_setup_complete', '1');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/push-subscriptions') {
        if (!pushReady) return json(res, 409, { error: 'Phone notifications are not configured.' });
        const subscription = await body(req);
        if (!validSubscription(subscription)) return json(res, 400, { error: 'Invalid phone subscription.' });
        store.saveSubscription(subscription);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && path === '/api/push-subscriptions') {
        const input = await body(req);
        if (typeof input.endpoint !== 'string') return json(res, 400, { error: 'Invalid phone subscription.' });
        store.removeSubscription(input.endpoint);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/items') return json(res, 200, { items: store.list() });
      if (req.method === 'POST' && path === '/api/items') {
        const result = await saveFind(await body(req));
        return json(res, result.existing ? 200 : 201, result);
      }
      const previewMatch = /^\/api\/items\/([\w-]+)\/preview$/.exec(path);
      if (previewMatch && req.method === 'POST') {
        const before = store.get(previewMatch[1]);
        if (!before) return json(res, 404, { error: 'Item not found.' });
        let details;
        try { details = await inspectProduct(before.url); }
        catch { return json(res, 200, { message: 'The store did not provide a preview. Your saved link is still here.' }); }
        const item = store.get(before.id);
        if (!item) return json(res, 404, { error: 'Item not found.' });
        const changes = {};
        if (details.image) changes.image = details.image;
        if (details.description) changes.description = details.description;
        if (item.title === new URL(item.url).hostname && details.title) changes.title = details.title;
        if (item.category_source !== 'manual') Object.assign(changes, guessCategory({
          url: item.url, title: changes.title || item.title, description: changes.description || item.description, note: item.note
        }));
        store.update(item.id, changes);
        await checkPrices(store, { itemId: item.id, inspect: async () => details,
          notify: pushReady ? ({ item, price }) => sendPushAlert(store, {
            item, price, publicKey: pushPublicKey, privateKey: pushPrivateKey, subject: pushSubject
          }) : null });
        return json(res, 200, { message: details.price != null ? 'Product details and price updated.' : 'Preview refreshed. Still waiting for a readable price.' });
      }
      const match = /^\/api\/items\/([\w-]+)$/.exec(path);
      if (match && req.method === 'PATCH') {
        const item = store.get(match[1]); if (!item) return json(res, 404, { error: 'Item not found.' });
        const input = await body(req); const changes = {};
        if (Object.hasOwn(input, 'watch_enabled')) {
          if (typeof input.watch_enabled !== 'boolean') throw new Error('Choose a valid watch setting.');
          changes.watch_enabled = input.watch_enabled ? 1 : 0;
          if (input.watch_enabled && item.discount_percent == null && item.target_price == null) changes.discount_percent = 20;
        }
        if (Object.hasOwn(input, 'title')) { changes.title = safeText(input.title, 180); if (!changes.title) throw new Error('Title cannot be empty.'); }
        if (Object.hasOwn(input, 'note')) changes.note = safeText(input.note, 500);
        if (Object.hasOwn(input, 'target_price')) { changes.target_price = target(input.target_price); changes.last_notified_at = null; }
        if (Object.hasOwn(input, 'discount_percent')) { changes.discount_percent = discount(input.discount_percent); changes.last_notified_at = null; }
        if (Object.hasOwn(input, 'category') || Object.hasOwn(input, 'subcategory')) {
          const category = input.category ?? item.category;
          const subcategory = input.subcategory ?? item.subcategory;
          if (!validCategory(category, subcategory)) throw new Error('Choose a valid category and subcategory.');
          Object.assign(changes, { category, subcategory, category_source: 'manual' });
        }
        return json(res, 200, { item: store.update(item.id, changes) });
      }
      if (match && req.method === 'DELETE') return json(res, store.remove(match[1]) ? 200 : 404, { ok: true });
      if (req.method === 'POST' && path === '/api/ask') {
        const input = await body(req);
        const answer = await askShoppingAssistant(store.list(), input.question, process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
        return json(res, 200, { answer });
      }
      return json(res, 404, { error: 'Not found.' });
    }
    if (req.method === 'GET' && staticFiles.has(path)) {
      const [file, type] = staticFiles.get(path);
      const bytes = await readFile(join(root, 'public', file));
      res.writeHead(200, { 'content-type': type, 'cache-control': ['index.html', 'sw.js'].includes(file) ? 'no-store' : 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(bytes); return;
    }
    json(res, 404, { error: 'Not found.' });
  } catch (error) {
    const clientError = /^(Enter |Paste |Use |Invalid |Request too large|Title cannot|Choose a valid|Ask a question|Set OPENAI_API_KEY)/.test(error.message);
    if (!clientError) console.error(error);
    json(res, clientError ? 400 : 502, { error: clientError ? error.message : 'That request could not be completed.' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(Number(process.env.PORT) || 3000, () => console.log(`Keep an Eye running on http://localhost:${server.address().port}`));
}
