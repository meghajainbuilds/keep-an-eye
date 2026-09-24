import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createStore } from '../lib/store.mjs';

test('share-sheet credential is save-only, revocable, persistent, and never authorizes URL-based writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'keep-capture-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = directory;
  process.env.APP_PASSWORD = randomBytes(24).toString('hex');
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  process.env.CRON_SECRET = randomBytes(32).toString('hex');
  const fixture = createStore(directory);
  const item = fixture.add({ url: 'https://example.com/saved-product', title: 'Private title', note: 'Private note', category: 'Home', subcategory: 'Decor', category_source: 'manual' });
  const { server } = await import('../server.mjs');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, method = 'GET', headers = {}, payload) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  try {
    assert.equal((await call('/api/capture', 'POST', {}, { url: item.url })).status, 401);
    assert.equal((await call('/api/shortcut-token', 'POST', {}, {})).status, 401);
    const login = await call('/api/login', 'POST', {}, { password: process.env.APP_PASSWORD });
    assert.equal(login.status, 200);
    const session = { cookie: login.headers.get('set-cookie').split(';')[0] };
    assert.equal((await call('/api/shortcut-token', 'POST', { ...session, origin: 'https://evil.example' }, {})).status, 403);
    const issued = await call('/api/shortcut-token', 'POST', session, {});
    assert.equal(issued.status, 201);
    assert.match(issued.headers.get('cache-control'), /no-store/);
    const { token } = await issued.json();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const auth = { authorization: 'Bearer ' + token };
    const hash = createHash('sha256').update(token).digest('hex');
    assert.equal(fixture.getSetting('shortcut_token_hash'), hash);
    const reopened = createStore(directory);
    assert.equal(reopened.getSetting('shortcut_token_hash'), hash);
    reopened.close();
    const existing = await call('/api/capture', 'POST', auth, { url: item.url, note: 'Overwrite', target_price: 1 });
    assert.equal(existing.status, 200);
    assert.deepEqual(await existing.json(), { message: 'Already saved to Keep an Eye.' });
    assert.equal(fixture.list().length, 1);
    assert.equal(fixture.get(item.id).note, 'Private note');
    assert.equal(fixture.get(item.id).target_price, null);
    for (const [path, method] of [['/api/items', 'GET'], ['/api/items/' + item.id, 'DELETE'], ['/api/shortcut-token', 'POST'], ['/api/check-prices', 'POST']]) {
      assert.equal((await call(path, method, auth)).status, 401);
    }
    assert.equal((await call('/api/capture?url=' + encodeURIComponent(item.url), 'GET', auth)).status, 401);
    assert.equal((await call('/api/capture', 'POST', { ...auth, origin: 'https://evil.example' }, { url: item.url })).status, 403);
    const invalid = await call('/api/capture', 'POST', auth, { url: 'http://127.0.0.1/private' });
    assert.equal(invalid.status, 400);
    const error = await invalid.json();
    assert.equal(error.message, error.error);
    const replacement = await (await call('/api/shortcut-token', 'POST', session, {})).json();
    assert.notEqual(replacement.token, token);
    assert.equal((await call('/api/capture', 'POST', auth, { url: item.url })).status, 401);
    assert.equal((await call('/api/capture', 'POST', { authorization: 'Bearer ' + replacement.token }, { url: item.url })).status, 200);
    assert.equal((await call('/api/shortcut-token', 'DELETE', session)).status, 200);
    assert.equal((await call('/api/capture', 'POST', { authorization: 'Bearer ' + replacement.token }, { url: item.url })).status, 401);
    assert.deepEqual(await (await call('/api/shortcut-token', 'GET', session)).json(), { enabled: false });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
