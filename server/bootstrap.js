import { initializeDatabaseRuntime, syncDatabaseDerivedState } from './db.js';
import { runMigrations } from './db/migrate.js';
import { seedNormalized } from './db/seedNormalized.js';
import { migrateLegacyData } from './db/legacy_migrate.js';
import { ensureDefaultSundayServices } from './db/default_services.js';
import { seedDatabase } from './seed.js';
import { seedTaskEngine, runTaskMaintenance } from './services/taskEngine.js';

export const runBootstrap = () => {
    runMigrations();
    initializeDatabaseRuntime();
    seedDatabase();
    seedNormalized();
    migrateLegacyData();
    ensureDefaultSundayServices();
    syncDatabaseDerivedState();
    seedTaskEngine();
    return runTaskMaintenance();
};
