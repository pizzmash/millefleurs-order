import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { openDb } from './db.ts';
import { importCatalog } from './import.ts';
import { createApp } from './app.ts';
const db = openDb();
if (!(db.prepare('SELECT COUNT(*) AS n FROM cocktails').get() as { n: number }).n) console.log('Imported catalog', importCatalog(db));
const app = createApp(db, { publicUrl: process.env.PUBLIC_URL });
app.use('*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535');
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, () => {
  console.log(`Home Bar: http://localhost:${port}${existsSync('dist/index.html') ? '' : ' (API; start Vite for UI)'}`);
});
const stop = () => { server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
