import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publicOrigin } from '../../worker/auth';
const required = (key: string) => {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Set ${key}`);
  return v;
};
const environment = required('CLOUD_ENV');
if (!['staging', 'production'].includes(environment))
  throw new Error('CLOUD_ENV must be staging or production');
const account = required('CLOUDFLARE_ACCOUNT_ID'),
  db = required('CLOUDFLARE_D1_ID'),
  project = required('FIREBASE_PROJECT_ID'),
  pages = required('CLOUDFLARE_PAGES_PROJECT');
if (!/^[a-z0-9-]+$/.test(pages) || !/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9-]{36}$/.test(db))
  throw new Error('Check Cloudflare resource identifiers');
const origin = publicOrigin(required('PUBLIC_APP_URL'));
const worker = `${pages}-api-${environment}`;
const directory = resolve('.runtime/cloud');
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}/${environment}.worker.json`,
  JSON.stringify(
    {
      name: worker,
      account_id: account,
      main: resolve('worker/index.ts'),
      compatibility_date: '2026-09-07',
      workers_dev: false,
      preview_urls: false,
      vars: { APP_ENV: environment, PUBLIC_APP_URL: origin, FIREBASE_PROJECT_ID: project },
      d1_databases: [
        {
          binding: 'DB',
          database_name: `${pages}-${environment}`,
          database_id: db,
          migrations_dir: resolve('migrations'),
        },
      ],
      triggers: { crons: ['17 * * * *'] },
      observability: { enabled: false },
    },
    null,
    2,
  ),
);
writeFileSync(
  `${directory}/${environment}.pages.json`,
  JSON.stringify(
    {
      name: pages,
      pages_build_output_dir: resolve('dist'),
      compatibility_date: '2026-09-07',
      services: [{ binding: 'API', service: worker }],
      // Preview builds are static only; the binding is never inherited by PR previews.
      env: { preview: { services: [] } },
    },
    null,
    2,
  ),
);
console.log(`Generated ${environment} configs in .runtime/cloud. No resources were created.`);
