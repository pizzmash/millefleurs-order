import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const environment = process.argv[2];
if (!['staging', 'production'].includes(environment))
  throw new Error('Usage: npm run cloud:deploy -- staging|production');
const worker = resolve(`.runtime/cloud/${environment}.worker.json`),
  pages = resolve(`.runtime/cloud/${environment}.pages.json`);
if (!existsSync(worker) || !existsSync(pages)) throw new Error('Run cloud:configure first');
const config = JSON.parse(readFileSync(worker, 'utf8'));
if (config.vars.APP_ENV !== environment) throw new Error('Environment mismatch');
if (
  !process.env.VITE_FIREBASE_API_KEY ||
  !process.env.VITE_FIREBASE_AUTH_DOMAIN ||
  !process.env.VITE_FIREBASE_APP_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID !== config.vars.FIREBASE_PROJECT_ID
)
  throw new Error('Export matching VITE_FIREBASE_* build settings before deploy');
const run = (bin: string, args: string[]) =>
  execFileSync(process.execPath, [resolve(`node_modules/${bin}`), ...args], { stdio: 'inherit' });
run('typescript/bin/tsc', ['--noEmit']);
run('vite/bin/vite.js', ['build']);
run('wrangler/bin/wrangler.js', [
  'd1',
  'migrations',
  'apply',
  'DB',
  '--remote',
  '--config',
  worker,
]);
run('tsx/dist/cli.mjs', ['scripts/cloud/catalog.ts']);
run('wrangler/bin/wrangler.js', [
  'd1',
  'execute',
  'DB',
  '--remote',
  '--config',
  worker,
  '--file',
  '.runtime/cloud/catalog.sql',
]);
run('wrangler/bin/wrangler.js', [
  'd1',
  'execute',
  'DB',
  '--remote',
  '--config',
  worker,
  '--file',
  '.runtime/cloud/activate-catalog.sql',
]);
run('wrangler/bin/wrangler.js', ['deploy', '--config', worker]);
run('tsx/dist/cli.mjs', ['scripts/cloud/deploy-pages.ts', environment]);
console.log('Deployment commands completed. Perform the smoke checks in docs/DEPLOYMENT.md.');
