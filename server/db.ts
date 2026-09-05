import './config.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDb(path = process.env.DB_PATH || '.runtime/bar.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > 1) throw new Error('Database version is newer than this application');
  if (version === 0) db.exec(`
    BEGIN;
    CREATE TABLE kinds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, alcoholic INTEGER NOT NULL CHECK(alcoholic IN (0,1)));
    CREATE TABLE techniques (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE glasses (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE drinks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind_id INTEGER REFERENCES kinds(id));
    CREATE TABLE cocktails (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, alcohol TEXT NOT NULL, alcohol_low REAL, alcohol_high REAL, image TEXT NOT NULL, glass_id INTEGER REFERENCES glasses(id), technique_id INTEGER REFERENCES techniques(id));
    CREATE TABLE recipes (id INTEGER PRIMARY KEY, cocktail_id INTEGER NOT NULL REFERENCES cocktails(id), drink_id INTEGER NOT NULL REFERENCES drinks(id), quantity TEXT NOT NULL);
    CREATE INDEX idx_recipes_cocktail ON recipes(cocktail_id);
    CREATE TABLE inventory (drink_id INTEGER PRIMARY KEY REFERENCES drinks(id), available INTEGER NOT NULL CHECK(available IN (0,1)));
    CREATE TABLE guests (id TEXT PRIMARY KEY, nickname TEXT NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), nickname TEXT NOT NULL, cocktail_id INTEGER NOT NULL, cocktail_name TEXT NOT NULL, image TEXT NOT NULL, technique TEXT NOT NULL, glass TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','completed')), created_at TEXT NOT NULL, completed_at TEXT, request_key TEXT NOT NULL, ingredients TEXT NOT NULL, UNIQUE(guest_id, request_key));
    CREATE INDEX idx_orders_status_created ON orders(status, created_at);
    CREATE INDEX idx_orders_guest_created ON orders(guest_id, created_at);
    PRAGMA user_version = 1;
    COMMIT;
  `);
  return db;
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
