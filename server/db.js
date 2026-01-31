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

    CREATE TABLE IF NOT EXISTS constant_contact_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TEXT,
        scope TEXT,
        token_type TEXT,
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS event_template_fields (
        id TEXT PRIMARY KEY,
        event_type_id INTEGER NOT NULL,
        field_key TEXT NOT NULL,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL,
        options_json TEXT,
        placeholder TEXT,
        help_text TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        required INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(event_type_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS event_documents (
        id TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        label TEXT,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
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
    const table = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'
    `).get();
    if (!table) return;
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
