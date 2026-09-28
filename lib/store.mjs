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
    merchant_category: "TEXT NOT NULL DEFAULT ''", category: "TEXT NOT NULL DEFAULT 'Other'", subcategory: "TEXT NOT NULL DEFAULT 'Other'",
    category_source: "TEXT NOT NULL DEFAULT 'rules'", watch_enabled: 'INTEGER NOT NULL DEFAULT 1',
    selected_url: 'TEXT', variant_id: 'TEXT', variant_label: 'TEXT', variants_json: "TEXT NOT NULL DEFAULT '[]'",
    extraction_status: "TEXT NOT NULL DEFAULT 'unavailable'", retry_count: 'INTEGER NOT NULL DEFAULT 0',
    next_attempt_at: 'TEXT', watch_scope: "TEXT NOT NULL DEFAULT 'product'", price_kind: "TEXT NOT NULL DEFAULT 'exact'", matched_variant: 'TEXT'
  })) if (!columns.has(name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
  if (!columns.has('extraction_status')) db.exec("UPDATE items SET extraction_status = 'pending'");
  // One-time opt-in for existing saves. A stopped watch stays stopped on restart.
  if (!columns.has('watch_enabled')) {
    db.exec('UPDATE items SET discount_percent = 20 WHERE discount_percent IS NULL AND target_price IS NULL');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS variant_watches (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL, variant_id TEXT NOT NULL, variant_label TEXT,
    selected_url TEXT, watch_enabled INTEGER NOT NULL DEFAULT 1,
    target_price REAL, discount_percent REAL DEFAULT 20, price REAL, baseline_price REAL, currency TEXT,
    price_source TEXT, observed_at TEXT, last_checked_at TEXT, last_notified_at TEXT,
    extraction_status TEXT NOT NULL DEFAULT 'pending', UNIQUE(item_id, variant_id)
  );`);
  // Preserve existing exact selections as independent watches. Product-wide observations
  // need a new baseline; an old single-size baseline must never be used for a whole product.
  if (!columns.has('watch_scope')) {
    db.exec('BEGIN');
    try {
      for (const item of db.prepare('SELECT * FROM items WHERE variant_id IS NOT NULL').all()) {
        db.prepare(`INSERT OR IGNORE INTO variant_watches
          (id,item_id,variant_id,variant_label,selected_url,watch_enabled,target_price,discount_percent,price,baseline_price,currency,price_source,observed_at,last_checked_at,last_notified_at,extraction_status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),item.id,item.variant_id,item.variant_label,item.selected_url || item.url,item.watch_enabled,item.target_price,item.discount_percent,item.price,item.baseline_price,item.currency,item.price_source,item.observed_at,item.last_checked_at,item.last_notified_at,item.extraction_status);
        db.prepare(`UPDATE items SET variant_id=NULL,variant_label=NULL,selected_url=NULL,
          price=NULL,baseline_price=NULL,currency=NULL,observed_at=NULL,last_notified_at=NULL,
          extraction_status='pending',watch_enabled=0,target_price=NULL,discount_percent=20 WHERE id=?`).run(item.id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const watches = id => db.prepare('SELECT * FROM variant_watches WHERE item_id=? ORDER BY rowid').all(id);
  const withWatches = item => item && { ...item, variant_watches: watches(item.id) };
  // Keep previously saved finds useful without sending old notes to an external service.
  const recategorize = db.prepare('UPDATE items SET category = ?, subcategory = ? WHERE id = ?');
  for (const item of db.prepare("SELECT * FROM items WHERE category_source = 'rules'").all()) {
    const result = guessCategory(item);
    recategorize.run(result.category, result.subcategory, item.id);
  }
  const list = () => db.prepare('SELECT * FROM items ORDER BY created_at DESC').all().map(withWatches);
  const get = id => withWatches(db.prepare('SELECT * FROM items WHERE id = ?').get(id));
  const byUrl = url => withWatches(db.prepare('SELECT * FROM items WHERE url = ?').get(url));
  const add = item => {
    const id = randomUUID(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO items (id, url, title, description, image, note, price, baseline_price, currency,
      price_source, target_price, discount_percent, observed_at, created_at, category, subcategory, category_source, watch_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.url, item.title, item.description || '',
      item.image || null, item.note || '', item.price ?? null, item.price ?? null, item.currency || null,
      item.price_source || null, item.target_price ?? null, item.discount_percent ?? (item.target_price == null ? 20 : null), item.price != null ? now : null, now,
      item.category || 'Other', item.subcategory || 'Other', item.category_source || 'rules', item.watch_enabled === false || item.watch_enabled === 0 ? 0 : 1);
    return update(id, { merchant_category: item.merchant_category || '', watch_scope: item.watch_scope || (item.variant_id ? 'variant' : 'product'), price_kind: item.price_kind || 'exact', variant_id: item.variant_id || null, variant_label: item.variant_label || null,
      variants_json: JSON.stringify(item.variants || []),
      extraction_status: item.extraction_status || (item.price != null ? 'verified' : 'pending') });
  };
  const update = (id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return get(id);
    const allowed = ['merchant_category', 'watch_scope', 'price_kind', 'matched_variant', 'selected_url', 'variant_id', 'variant_label', 'variants_json', 'extraction_status', 'retry_count', 'next_attempt_at', 'watch_enabled', 'title', 'note', 'target_price', 'discount_percent', 'price', 'baseline_price', 'currency', 'price_source', 'image', 'description', 'observed_at', 'last_checked_at', 'last_notified_at', 'category', 'subcategory', 'category_source'];
    if (keys.some(k => !allowed.includes(k))) throw new Error('Invalid update.');
    db.prepare(`UPDATE items SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
    return get(id);
  };
  const getWatch = id => db.prepare('SELECT * FROM variant_watches WHERE id=?').get(id);
  const updateWatch = (id, fields) => {
    const allowed = ['watch_enabled','target_price','discount_percent','price','baseline_price','currency','price_source','observed_at','last_checked_at','last_notified_at','extraction_status','variant_label'];
    const keys = Object.keys(fields);
    if (keys.some(k => !allowed.includes(k))) throw new Error('Invalid watch update.');
    if (keys.length) db.prepare(`UPDATE variant_watches SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`).run(...keys.map(k => fields[k]), id);
    return getWatch(id);
  };
  const addWatch = (itemId, variant, settings = {}) => {
    if (!get(itemId)) throw new Error('Item not found.');
    const existing = watches(itemId).find(w => w.variant_id === variant.id);
    if (existing) return existing;
    if (watches(itemId).length >= 20) throw new Error('Choose at most 20 variant alerts per product.');
    const id = randomUUID();
    db.prepare(`INSERT INTO variant_watches (id,item_id,variant_id,variant_label,selected_url,target_price,discount_percent)
      VALUES (?,?,?,?,?,?,?)`).run(id,itemId,variant.id,variant.label,variant.url || get(itemId).url,settings.target_price ?? null,settings.discount_percent ?? (settings.target_price == null ? 20 : null));
    return getWatch(id);
  };
  const removeWatch = id => db.prepare('DELETE FROM variant_watches WHERE id=?').run(id).changes > 0;
  const remove = id => {
    db.prepare('DELETE FROM variant_watches WHERE item_id=?').run(id);
    return db.prepare('DELETE FROM items WHERE id=?').run(id).changes > 0;
  };
  const saveSubscription = ({ endpoint, keys }) => db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(endpoint, keys.p256dh, keys.auth, new Date().toISOString());
  const removeSubscription = endpoint => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes > 0;
  const subscriptions = () => db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
  const getSetting = key => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;
  const setSetting = (key, value) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  return { watches, getWatch, addWatch, updateWatch, removeWatch, getSetting, setSetting, list, get, byUrl, add, update, remove, saveSubscription, removeSubscription, subscriptions, close: () => db.close() };
}
