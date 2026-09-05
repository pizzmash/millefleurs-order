import { openDb } from './db.ts';
import { importCatalog } from './import.ts';
const db = openDb();
try {
  console.log(JSON.stringify(importCatalog(db), null, 2));
} finally {
  db.close();
}
