import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve('.');
test('generated and legacy Pages configs pass real deploy validation before authentication', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'pages-deploy-test-'));
  try {
    mkdirSync(resolve(directory, 'dist'));
    writeFileSync(resolve(directory, 'dist/index.html'), '<html>test</html>');
    cpSync(resolve(root, 'functions'), resolve(directory, 'functions'), { recursive: true });
    symlinkSync(resolve(root, 'node_modules'), resolve(directory, 'node_modules'), 'dir');
    // Never use developer credentials or access Cloudflare from this test.
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      XDG_CONFIG_HOME: resolve(directory, 'config'),
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
      CLOUD_ENV: 'production',
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      CLOUDFLARE_D1_ID: '11111111-1111-1111-1111-111111111111',
      CLOUDFLARE_PAGES_PROJECT: 'pages-regression-test',
      FIREBASE_PROJECT_ID: 'pages-regression-test',
      PUBLIC_APP_URL: 'https://pages-regression-test.pages.dev',
    };
    const run = (script: string, args: string[] = []) =>
      spawnSync(
        process.execPath,
        [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, script), ...args],
        { cwd: directory, env, encoding: 'utf8', timeout: 30_000 },
      );
    const configured = run('scripts/cloud/configure.ts');
    assert.equal(configured.status, 0, configured.stdout + configured.stderr);
    const path = resolve(directory, '.runtime/cloud/production.pages.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(config.account_id, undefined);
    for (const legacy of [false, true]) {
      if (legacy)
        writeFileSync(path, JSON.stringify({ ...config, account_id: env.CLOUDFLARE_ACCOUNT_ID }));
      const deployed = run('scripts/cloud/deploy-pages.ts', ['production']);
      const output = deployed.stdout + deployed.stderr;
      assert.notEqual(deployed.status, 0);
      assert.match(output, /CLOUDFLARE_API_TOKEN/, output);
      assert.doesNotMatch(output, /does not support|configuration file validation|custom paths/i);
      assert.equal(
        readdirSync(resolve(directory, '.runtime/cloud')).some((name) =>
          name.startsWith('pages-deploy-'),
        ),
        false,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
