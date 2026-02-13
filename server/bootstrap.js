import { runMigrations } from './db/migrate.js';
import { seedNormalized } from './db/seedNormalized.js';
import { migrateLegacyData } from './db/legacy_migrate.js';
import { ensureDefaultSundayServices } from './db/default_services.js';
import { seedDatabase } from './seed.js';
import { seedTaskEngine } from './services/taskEngine.js';

export const runBootstrap = () => {
    runMigrations();
    seedDatabase();
    seedNormalized();
    migrateLegacyData();
    ensureDefaultSundayServices();
    seedTaskEngine();
};
