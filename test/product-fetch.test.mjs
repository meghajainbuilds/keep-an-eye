import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fetchProductHtml, parseProduct } from '../lib/product.mjs';

const fixture = readFileSync(new URL('./fixtures/quince-cardigan.html', import.meta.url), 'utf8');

test('Quince preview uses merchant title and image without assuming a variant price', () => {
  const product = parseProduct(fixture, 'https://share.google/example');
  assert.equal(product.title, 'Luxe Baby Cashmere Cable Cardigan in Heather Pewter');
  assert.match(product.image, /^https:\/\/images\.quince\.com\//);
  assert.ok(product.image.includes('&q=90'));
  assert.equal(product.price, null);
});

test('fetch supports Node all-address lookup, larger product pages, redirects and size limit', async t => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.215.14', family: 4 }]);
  let tooLarge = false;
  let requests = 0;
  t.mock.method(https, 'get', (url, options, onResponse) => {
    const req = new EventEmitter();
    req.destroy = error => req.emit('error', error);
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: '93.184.215.14', family: 4 }]);
    });
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.equal(address, '93.184.215.14'); assert.equal(family, 4);
    });
    queueMicrotask(() => {
      requests++;
      const res = new EventEmitter();
      res.resume = () => {};
      if (url.hostname === 'share.google') {
        res.statusCode = 302; res.headers = { location: 'https://www.quince.com/cardigan' };
        onResponse(res); return;
      }
      res.statusCode = 200; res.headers = { 'content-type': 'text/html' };
      onResponse(res);
      res.emit('data', Buffer.from(fixture + ' '.repeat(tooLarge ? 2_000_001 : 730_000)));
      res.emit('end');
    });
    return req;
  });
  const html = await fetchProductHtml('https://share.google/example');
  assert.equal(requests, 2);
  assert.ok(html.length > 500_000);
  assert.match(parseProduct(html, 'https://www.quince.com/cardigan').image, /images.quince.com/);
  tooLarge = true;
  await assert.rejects(fetchProductHtml('https://www.quince.com/cardigan'), /too large/);
});
