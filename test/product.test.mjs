import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, fetchProductHtml, parseProduct } from '../lib/product.mjs';
import { createStore } from '../lib/store.mjs';
import { checkPrices } from '../lib/alerts.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const page = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Linen &amp; cotton dress","offers":{"@type":"Offer","price":"89.00","priceCurrency":"USD"}}</script></head></html>`;

test('extracts a merchant price and currency as one observation', () => {
  const product = parseProduct(page, 'https://store.example/dress');
  assert.equal(product.price, 89);
  assert.equal(product.currency, 'USD');
  assert.equal(product.title, 'Linen & cotton dress');
  assert.equal(product.price_source, 'JSON-LD offer');
});

test('does not treat a price without a currency as an alertable price', () => {
  const product = parseProduct('<meta property="product:price:amount" content="40">', 'https://store.example/a');
  assert.equal(product.price, null);
});

test('rejects credentialed links and local addresses before fetching', async () => {
  assert.throws(() => cleanUrl('https://someone:password@store.example/product'));
  await assert.rejects(fetchProductHtml('http://127.0.0.1/private'), /cannot be fetched/i);
});

test('alerts once on a threshold, rearms only after price rises, and does not send on an unreadable page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keep-eye-'));
  const store = createStore(dir);
  try {
    const item = store.add({ url: 'https://store.example/item', title: 'Dress', currency: 'USD', price: 120, target_price: 90 });
    let observed = 89; let sent = 0;
    const options = { inspect: async () => ({ price: observed, currency: 'USD', price_source: 'JSON-LD offer' }),
      notify: async () => { sent++; } };
    await checkPrices(store, options);
    await checkPrices(store, options);
    assert.equal(sent, 1);
    observed = null;
    assert.equal((await checkPrices(store, options)).unavailable, 1);
    assert.equal(sent, 1);
    observed = 100;
    await checkPrices(store, options);
    assert.equal(store.get(item.id).last_notified_at, null);
    observed = 80;
    await checkPrices(store, options);
    assert.equal(sent, 2);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('discount alert establishes a baseline and fires after a 20 percent drop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keep-eye-discount-'));
  const store = createStore(dir);
  try {
    const item = store.add({ url: 'https://store.example/coat', title: 'Coat', discount_percent: 20 });
    let observed = 100; let sent = 0;
    const options = { inspect: async () => ({ price: observed, currency: 'USD', price_source: 'JSON-LD offer' }),
      notify: async () => { sent++; } };
    await checkPrices(store, options);
    assert.equal(store.get(item.id).baseline_price, 100);
    observed = 85;
    await checkPrices(store, options);
    assert.equal(sent, 0);
    observed = 80;
    await checkPrices(store, options);
    assert.equal(sent, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
