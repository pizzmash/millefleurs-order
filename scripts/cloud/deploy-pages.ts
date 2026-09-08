import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const environment = process.argv[2];
if (!['staging', 'production'].includes(environment))
  throw new Error('Usage: npm run cloud:deploy:pages -- staging|production');
const source = resolve(`.runtime/cloud/${environment}.pages.json`);
if (!existsSync(source)) throw new Error('Run cloud:configure first');
const config = JSON.parse(readFileSync(source, 'utf8'));
// Older generated Pages configs included account_id, which Pages rejects.
// Use the matching Worker config as the account source for new configs.
const workerSource = resolve(`.runtime/cloud/${environment}.worker.json`);
const workerAccount = existsSync(workerSource)
  ? JSON.parse(readFileSync(workerSource, 'utf8')).account_id
  : undefined;
if (workerAccount && config.account_id && workerAccount !== config.account_id)
  throw new Error('Worker and Pages account IDs do not match; run cloud:configure again');
const account = workerAccount || config.account_id;
if (typeof account !== 'string' || !/^[a-f0-9]{32}$/.test(account))
  throw new Error('Missing valid deployment account; run cloud:configure first');
delete config.account_id;
const output = config.pages_build_output_dir;
if (!output || !existsSync(resolve(output, 'index.html')))
  throw new Error('Build the target environment before deploying Pages');

// Pages discovers a standard config in cwd and rejects the --config flag.
// Keep the API Worker configuration untouched and include the Functions source.
const parent = resolve('.runtime/cloud');
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(resolve(parent, 'pages-deploy-'));
try {
  writeFileSync(resolve(directory, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
  cpSync(resolve('functions'), resolve(directory, 'functions'), { recursive: true });
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'deploy',
      output,
      '--branch',
      'main',
    ],
    { cwd: directory, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account } },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
