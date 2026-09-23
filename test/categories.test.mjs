import test from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, categorizeProduct } from '../lib/categories.mjs';
import { createStore } from '../lib/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

test('sorts adult dresses, electronics and kids shoes into browsable subcategories', () => {
  assert.deepEqual(guessCategory({ title: 'Linen dress' }), { category: 'Apparel', subcategory: 'Dresses' });
  assert.deepEqual(guessCategory({ title: 'Wireless headphones' }), { category: 'Electronics', subcategory: 'Audio' });
  assert.deepEqual(guessCategory({ title: 'Kids running shoes' }), { category: 'Kids', subcategory: 'Shoes' });
});

test('keeps the item and its category editable when AI classification fails', async () => {
  const result = await categorizeProduct({ title: 'Leather boots' }, 'fake-key', 'model', async () => ({ ok: false }));
  assert.deepEqual(result, { category: 'Shoes', subcategory: 'Boots', category_source: 'rules' });
});

test('accepts only category and subcategory pairs in the taxonomy from AI', async () => {
  const response = async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '{"category":"Kids","subcategory":"Toys"}' }] }] }) });
  assert.deepEqual(await categorizeProduct({ title: 'Building blocks' }, 'fake', 'model', response),
    { category: 'Kids', subcategory: 'Toys', category_source: 'ai' });
  const invalid = async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '{"category":"Kids","subcategory":"Dresses"}' }] }] }) });
  assert.equal((await categorizeProduct({ title: 'Building blocks' }, 'fake', 'model', invalid)).category_source, 'rules');
});

test('migrates an older saved collection and preserves manual edits on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'keep-eye-categories-'));
  try {
    const old = new DatabaseSync(join(directory, 'products.sqlite'));
    old.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', image TEXT, note TEXT NOT NULL DEFAULT '',
      price REAL, baseline_price REAL, currency TEXT, price_source TEXT, target_price REAL, discount_percent REAL,
      observed_at TEXT, last_checked_at TEXT, last_notified_at TEXT, created_at TEXT NOT NULL);
      INSERT INTO items(id, url, title, created_at) VALUES ('old', 'https://shop.example/boots', 'Leather boots', '2026-01-01');`);
    old.close();
    const store = createStore(directory);
    assert.deepEqual([store.get('old').category, store.get('old').subcategory], ['Shoes', 'Boots']);
    const item = store.add({ url: 'https://shop.example/dress', title: 'Summer dress', ...guessCategory({ title: 'Summer dress' }) });
    store.update(item.id, { category: 'Kids', subcategory: 'Clothing', category_source: 'manual' });
    store.close();
    const reopened = createStore(directory);
    assert.equal(reopened.get(item.id).category, 'Kids');
    assert.equal(reopened.get(item.id).subcategory, 'Clothing');
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
