import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { openDb } from './db.ts';
const db = openDb();
mkdirSync('.runtime/backups', { recursive: true });
const target = `.runtime/backups/bar-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
try { await backup(db, target); console.log(target); } finally { db.close(); }
