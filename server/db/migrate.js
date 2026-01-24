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

    // Skip legacy migrations when using the new canonical schema (no tasks_new/generation_key).
    if (!hasTable('tasks_new') && hasTable('tasks') && hasTable('task_instances') && !hasColumn('task_instances', 'generation_key')) {
        return;
    }

    migrate(db, {
        migrationsFolder: join(__dirname, 'migrations')
    });
};

export const closeDb = () => {
    sqlite.close();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations();
    closeDb();
}
