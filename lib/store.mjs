import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { guessCategory } from './categories.mjs';

export function createStore(directory = './data') {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'products.sqlite'));
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', image TEXT, note TEXT NOT NULL DEFAULT '',
      price REAL, baseline_price REAL, currency TEXT, price_source TEXT, target_price REAL, discount_percent REAL,
      observed_at TEXT, last_checked_at TEXT, last_notified_at TEXT,
      created_at TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other',
      subcategory TEXT NOT NULL DEFAULT 'Other', category_source TEXT NOT NULL DEFAULT 'rules'
    );
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  const columns = new Set(db.prepare('PRAGMA table_info(items)').all().map(column => column.name));
  for (const [name, definition] of Object.entries({
    category: "TEXT NOT NULL DEFAULT 'Other'", subcategory: "TEXT NOT NULL DEFAULT 'Other'",
    category_source: "TEXT NOT NULL DEFAULT 'rules'", watch_enabled: 'INTEGER NOT NULL DEFAULT 1',
    selected_url: 'TEXT', variant_id: 'TEXT', variant_label: 'TEXT', variants_json: "TEXT NOT NULL DEFAULT '[]'",
    extraction_status: "TEXT NOT NULL DEFAULT 'unavailable'", retry_count: 'INTEGER NOT NULL DEFAULT 0',
    next_attempt_at: 'TEXT'
  })) if (!columns.has(name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
  if (!columns.has('extraction_status')) db.exec("UPDATE items SET extraction_status = 'pending'");
  // One-time opt-in for existing saves. A stopped watch stays stopped on restart.
  if (!columns.has('watch_enabled')) {
    db.exec('UPDATE items SET discount_percent = 20 WHERE discount_percent IS NULL AND target_price IS NULL');
  }
  // Keep previously saved finds useful without sending old notes to an external service.
  const recategorize = db.prepare('UPDATE items SET category = ?, subcategory = ? WHERE id = ?');
  for (const item of db.prepare("SELECT * FROM items WHERE category = 'Other' AND category_source = 'rules'").all()) {
    const result = guessCategory(item);
    if (result.category !== 'Other') recategorize.run(result.category, result.subcategory, item.id);
  }
  const list = () => db.prepare('SELECT * FROM items ORDER BY created_at DESC').all();
  const get = id => db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  const byUrl = url => db.prepare('SELECT * FROM items WHERE url = ?').get(url);
  const add = item => {
    const id = randomUUID(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO items (id, url, title, description, image, note, price, baseline_price, currency,
      price_source, target_price, discount_percent, observed_at, created_at, category, subcategory, category_source, watch_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.url, item.title, item.description || '',
      item.image || null, item.note || '', item.price ?? null, item.price ?? null, item.currency || null,
      item.price_source || null, item.target_price ?? null, item.discount_percent ?? (item.target_price == null ? 20 : null), item.price != null ? now : null, now,
      item.category || 'Other', item.subcategory || 'Other', item.category_source || 'rules', item.watch_enabled === false || item.watch_enabled === 0 ? 0 : 1);
    return update(id, { variant_id: item.variant_id || null, variant_label: item.variant_label || null,
      variants_json: JSON.stringify(item.variants || []),
      extraction_status: item.extraction_status || (item.price != null ? 'verified' : 'pending') });
  };
  const update = (id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return get(id);
    const allowed = ['selected_url', 'variant_id', 'variant_label', 'variants_json', 'extraction_status', 'retry_count', 'next_attempt_at', 'watch_enabled', 'title', 'note', 'target_price', 'discount_percent', 'price', 'baseline_price', 'currency', 'price_source', 'image', 'description', 'observed_at', 'last_checked_at', 'last_notified_at', 'category', 'subcategory', 'category_source'];
    if (keys.some(k => !allowed.includes(k))) throw new Error('Invalid update.');
    db.prepare(`UPDATE items SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
    return get(id);
  };
  const remove = id => db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  const saveSubscription = ({ endpoint, keys }) => db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(endpoint, keys.p256dh, keys.auth, new Date().toISOString());
  const removeSubscription = endpoint => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes > 0;
  const subscriptions = () => db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
  const getSetting = key => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;
  const setSetting = (key, value) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  return { getSetting, setSetting, list, get, byUrl, add, update, remove, saveSubscription, removeSubscription, subscriptions, close: () => db.close() };
}
