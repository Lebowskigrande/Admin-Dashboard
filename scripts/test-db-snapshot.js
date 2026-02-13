import { copyFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DB_PATH = join(ROOT, 'server', 'church.db');
const SNAPSHOT_PATH = join(ROOT, 'server', 'church.db.test-snapshot');
const command = String(process.argv[2] || '').trim().toLowerCase();

const ensureExists = async (path, label) => {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        console.error(`[test-db] Missing ${label}: ${path}`);
        return false;
    }
};

const saveSnapshot = async () => {
    if (!await ensureExists(DB_PATH, 'database')) {
        process.exitCode = 1;
        return;
    }
    await copyFile(DB_PATH, SNAPSHOT_PATH);
    console.log(`[test-db] Snapshot saved: ${SNAPSHOT_PATH}`);
};

const restoreSnapshot = async () => {
    if (!await ensureExists(SNAPSHOT_PATH, 'snapshot')) {
        process.exitCode = 1;
        return;
    }
    await copyFile(SNAPSHOT_PATH, DB_PATH);
    console.log(`[test-db] Snapshot restored to: ${DB_PATH}`);
};

const run = async () => {
    if (command === 'save') {
        await saveSnapshot();
        return;
    }
    if (command === 'restore') {
        await restoreSnapshot();
        return;
    }
    console.log('[test-db] Usage: node scripts/test-db-snapshot.js <save|restore>');
    process.exitCode = 1;
};

run().catch((error) => {
    console.error('[test-db] Failed:', error);
    process.exitCode = 1;
});
