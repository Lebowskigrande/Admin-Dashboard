import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'church.db'));
const month = '2025-12';
const events = db.prepare('SELECT date, feast FROM liturgical_days WHERE date LIKE ?').all(`${month}%`);
console.log(`Found ${events.length} events for ${month}:`);
events.forEach(e => console.log(`${e.date}: ${e.feast}`));
