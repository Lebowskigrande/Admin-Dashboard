import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from '../db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const runMigrations = () => {
    const hasTable = (name) => sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name);
    const hasColumn = (tableName, columnName) => {
        if (!hasTable(tableName)) return false;
        const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name);
        return columns.includes(columnName);
    };

    // Skip migrations for legacy task schemas only if the core event tables already exist.
    const isLegacyTasks = !hasTable('tasks_new')
        && hasTable('tasks')
        && hasTable('task_instances')
        && !hasColumn('task_instances', 'generation_key');
    if (isLegacyTasks) {
        const coreTables = ['events', 'event_occurrences', 'event_types', 'event_categories'];
        const hasCoreTables = coreTables.every((table) => hasTable(table));
        if (hasCoreTables) {
            return;
        }
    }

    migrate(db, {
        migrationsFolder: join(__dirname, 'migrations')
    });

    if (hasTable('people')) {
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
    }
};

export const closeDb = () => {
    sqlite.close();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations();
    closeDb();
}
