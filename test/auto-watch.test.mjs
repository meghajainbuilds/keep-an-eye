import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../lib/store.mjs';
import { checkPrices } from '../lib/alerts.mjs';

test('new saves watch 20% by default; unreadable prices wait; stopped watches persist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-watch-'));
  let store = createStore(dir);
  try {
    const item = store.add({ url: 'https://store.example/cardigan', title: 'Cardigan' });
    assert.equal(item.watch_enabled, 1);
    assert.equal(item.discount_percent, 20);
    let price = null, sent = 0, inspected = 0;
    const options = { inspect: async () => { inspected++; return { price, currency: 'USD', price_source: 'fixture offer' }; },
      notify: async () => { sent++; } };
    await checkPrices(store, options);
    assert.equal(store.get(item.id).baseline_price, null);
    price = 100.00;
    await checkPrices(store, options);
    assert.equal(store.get(item.id).baseline_price, 100.00);
    assert.equal(sent, 0);
    price = 80.01;
    await checkPrices(store, options);
    assert.equal(sent, 0);
    price = 80.00;
    await Promise.all([checkPrices(store, options), checkPrices(store, options)]);
    assert.equal(sent, 1);
    store.update(item.id, { watch_enabled: 0 });
    store.close(); store = createStore(dir);
    assert.equal(store.get(item.id).watch_enabled, 0);
    const count = inspected;
    await checkPrices(store, options);
    assert.equal(inspected, count);
    // Resuming at the same low price does not repeat a delivered alert.
    store.update(item.id, { watch_enabled: 1 });
    await checkPrices(store, options);
    assert.equal(sent, 1);
    price = 100.00; await checkPrices(store, options);
    price = 75; await checkPrices(store, options);
    assert.equal(sent, 2);
    assert.equal(store.get(item.id).baseline_price, 100.00);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('old saves migrate to automatic watching once and preserve custom data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'watch-migration-'));
  const db = new DatabaseSync(join(dir, 'products.sqlite'));
  db.exec(`CREATE TABLE items (
    id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', image TEXT, note TEXT NOT NULL DEFAULT '',
    price REAL, baseline_price REAL, currency TEXT, price_source TEXT, target_price REAL, discount_percent REAL,
    observed_at TEXT, last_checked_at TEXT, last_notified_at TEXT, created_at TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other', subcategory TEXT NOT NULL DEFAULT 'Other',
    category_source TEXT NOT NULL DEFAULT 'rules');
    INSERT INTO items (id,url,title,note,created_at,category,subcategory,category_source)
    VALUES ('old','https://store.example/a','My name','My note','2026-09-24','Apparel','Tops','manual');`);
  db.close();
  let store = createStore(dir);
  try {
    const item = store.get('old');
    assert.equal(item.discount_percent, 20);
    assert.equal(item.watch_enabled, 1);
    assert.equal(item.note, 'My note');
    assert.equal(item.category_source, 'manual');
    store.update('old', { watch_enabled: 0 });
    store.close(); store = createStore(dir);
    assert.equal(store.get('old').watch_enabled, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('stopping a watch during a fetch prevents an alert; failed notifications retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'watch-race-'));
  const store = createStore(dir);
  try {
    const item = store.add({ url: 'https://store.example/a', title: 'A', price: 100, currency: 'USD' });
    let sent = 0;
    await checkPrices(store, { inspect: async () => {
      store.update(item.id, { watch_enabled: 0 });
      return { price: 70, currency: 'USD', price_source: 'fixture' };
    }, notify: async () => { sent++; } });
    assert.equal(sent, 0);
    store.update(item.id, { watch_enabled: 1 });
    const inspect = async () => ({ price: 70, currency: 'USD', price_source: 'fixture' });
    await checkPrices(store, { inspect, notify: async () => { throw new Error('offline'); } });
    assert.equal(store.get(item.id).last_notified_at, null);
    await checkPrices(store, { inspect, notify: async () => { sent++; } });
    assert.equal(sent, 1);
    await checkPrices(store, { inspect: async () => ({ price: 1, currency: 'EUR' }), notify: async () => { sent++; } });
    assert.equal(store.get(item.id).currency, 'USD');
    assert.equal(store.get(item.id).price, 70);
    assert.equal(sent, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
