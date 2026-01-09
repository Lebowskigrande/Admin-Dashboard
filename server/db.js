import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema.js';
import { vestryChecklistItems } from './vestryChecklistData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'church.db');
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS vestry_checklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month INTEGER,
        month_name TEXT,
        phase TEXT,
        task TEXT,
        notes TEXT,
        sort_order INTEGER
    );
`);

const seedVestryChecklist = () => {
    const count = sqlite.prepare('SELECT count(*) as count FROM vestry_checklist').get().count;
    if (count === vestryChecklistItems.length) return;
    if (count > 0) {
        sqlite.prepare('DELETE FROM vestry_checklist').run();
    }
    const insert = sqlite.prepare(`
        INSERT INTO vestry_checklist (month, month_name, phase, task, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    vestryChecklistItems.forEach((item) => {
        insert.run(
            item.month,
            item.monthName,
            item.phase,
            item.task,
            item.notes || '',
            item.sortOrder || 0
        );
    });
};

seedVestryChecklist();

console.log('Database initialized at', dbPath);

export { sqlite, db };
export default sqlite;
