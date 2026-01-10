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

const ensurePeopleColumns = () => {
    const columns = sqlite.prepare('PRAGMA table_info(people)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    const addColumn = (name) => {
        if (!columnSet.has(name)) {
            sqlite.exec(`ALTER TABLE people ADD COLUMN ${name} TEXT`);
            columnSet.add(name);
        }
    };

    addColumn('phone_primary');
    addColumn('phone_alternate');
    addColumn('address_line1');
    addColumn('address_line2');
    addColumn('city');
    addColumn('state');
    addColumn('postal_code');
};

ensurePeopleColumns();

console.log('Database initialized at', dbPath);

export { sqlite, db };
export default sqlite;
