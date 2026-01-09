import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from '../db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const runMigrations = () => {
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
