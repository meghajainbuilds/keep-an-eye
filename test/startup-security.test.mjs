import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('unsafe startup credentials fail before creating a collection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'keep-startup-'));
  const data = join(directory, 'data');
  try {
    for (const invalid of [
      { APP_PASSWORD: 'short' },
      { SESSION_SECRET: 'replace-with-a-random-secret-at-least-32-characters' },
      { CRON_SECRET: 's'.repeat(40) }
    ]) {
      const result = spawnSync(process.execPath, ['server.mjs'], {
        cwd: new URL('..', import.meta.url), timeout: 5000, encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test', DATA_DIR: data,
          APP_PASSWORD: 'fictional-test-password', SESSION_SECRET: 's'.repeat(40),
          CRON_SECRET: 'c'.repeat(40), ...invalid }
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Replace all example placeholders/);
      assert.equal(existsSync(data), false);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
