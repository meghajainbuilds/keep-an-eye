import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { checkPrices } from '../lib/alerts.mjs';
import { sendPushAlert, validSubscription } from '../lib/push.mjs';

const key = length => Buffer.alloc(length, 1).toString('base64url');
const subscription = { endpoint: 'https://web.push.apple.com/example', keys: { p256dh: key(65), auth: key(16) } };

test('only known push endpoints and valid encryption keys can be saved', () => {
  assert.equal(validSubscription(subscription), true);
  assert.equal(validSubscription({ ...subscription, endpoint: 'https://127.0.0.1/private' }), false);
  assert.equal(validSubscription({ ...subscription, endpoint: 'https://web.push.apple.com.evil.example/test' }), false);
  assert.equal(validSubscription({ ...subscription, keys: { ...subscription.keys, auth: key(4) } }), false);
});

test('sends one price alert to saved phones, removes expired phones, and retries after failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keep-eye-push-'));
  const store = createStore(dir);
  try {
    const item = store.add({ url: 'https://shop.example/dress', title: 'Linen dress', price: 120, currency: 'USD', target_price: 90 });
    store.saveSubscription(subscription);
    let observed = 85; let sent = 0;
    const notify = ({ item, price }) => sendPushAlert(store, { item, price, publicKey: 'public', privateKey: 'private', subject: 'mailto:owner@example.com',
      send: async (_subscription, payload) => {
        sent++;
        assert.match(JSON.parse(payload).body, /\$85\.00/);
        assert.equal(JSON.parse(payload).url, `/?item=${item.id}`);
      } });
    const inspect = async () => ({ price: observed, currency: 'USD', price_source: 'JSON-LD offer' });
    await checkPrices(store, { inspect, notify });
    await checkPrices(store, { inspect, notify });
    assert.equal(sent, 1);
    observed = 100;
    await checkPrices(store, { inspect, notify });
    observed = 80;
    const expired = ({ item, price }) => sendPushAlert(store, { item, price, publicKey: 'public', privateKey: 'private', subject: 'mailto:owner@example.com',
      send: async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); } });
    const result = await checkPrices(store, { inspect, notify: expired });
    assert.equal(result.alerted, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(store.get(item.id).last_notified_at, null);
    assert.equal(store.subscriptions().length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
