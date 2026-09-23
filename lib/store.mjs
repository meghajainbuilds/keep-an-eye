import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createStore(directory = './data') {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'products.sqlite'));
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', image TEXT, note TEXT NOT NULL DEFAULT '',
      price REAL, baseline_price REAL, currency TEXT, price_source TEXT, target_price REAL, discount_percent REAL,
      observed_at TEXT, last_checked_at TEXT, last_notified_at TEXT,
      created_at TEXT NOT NULL
    );`);
  const list = () => db.prepare('SELECT * FROM items ORDER BY created_at DESC').all();
  const get = id => db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  const byUrl = url => db.prepare('SELECT * FROM items WHERE url = ?').get(url);
  const add = item => {
    const id = randomUUID(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO items (id, url, title, description, image, note, price, baseline_price, currency,
      price_source, target_price, discount_percent, observed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.url, item.title, item.description || '',
      item.image || null, item.note || '', item.price ?? null, item.price ?? null, item.currency || null,
      item.price_source || null, item.target_price ?? null, item.discount_percent ?? null, item.price != null ? now : null, now);
    return get(id);
  };
  const update = (id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return get(id);
    const allowed = ['title', 'note', 'target_price', 'discount_percent', 'price', 'baseline_price', 'currency', 'price_source', 'image', 'description', 'observed_at', 'last_checked_at', 'last_notified_at'];
    if (keys.some(k => !allowed.includes(k))) throw new Error('Invalid update.');
    db.prepare(`UPDATE items SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
    return get(id);
  };
  const remove = id => db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  return { list, get, byUrl, add, update, remove, close: () => db.close() };
}
