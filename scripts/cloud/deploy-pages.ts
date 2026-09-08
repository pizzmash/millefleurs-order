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
    { cwd: directory, stdio: 'inherit' },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
