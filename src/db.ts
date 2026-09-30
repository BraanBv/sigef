import fs from 'fs';
import path from 'path';
import { DB } from './types';
import { buildSeed } from './seed';

const FILE = path.join(process.cwd(), 'data', 'db.json');
let db: DB | null = null;

/** "Base de datos" JSON: se carga una vez en memoria y se persiste con escritura atómica. */
export function load(): DB {
  if (db) return db;
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8')) as DB;
  else { db = buildSeed(); save(); console.log('Base de datos inicial creada en data/db.json'); }
  return db;
}
export function save(): void {
  if (!db) return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}
