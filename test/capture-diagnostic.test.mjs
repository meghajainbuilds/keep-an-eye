import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDiagnostic } from '../lib/capture-diagnostic.mjs';
test('capture diagnostics reveal structure but no URL contents or secrets', () => {
  const d = captureDiagnostic('googleapp://user:password@example.com/private?url=https%3A%2F%2Fstore.example%2Fprivate%3Ftoken%3Dsecret&token=secret');
  assert.equal(d.scheme, 'googleapp');
  assert.equal(d.embeddedWebUrl, true);
  assert.equal(d.hasCredentials, true);
  for (const value of ['password', 'store.example', 'private', 'secret', 'token']) assert.ok(!JSON.stringify(d).includes(value));
  assert.deepEqual(captureDiagnostic(null), { type: 'null' });
  assert.deepEqual(captureDiagnostic(['https://example.com']), { type: 'array' });
  assert.equal(captureDiagnostic('not a url').scheme, 'missing');
});
