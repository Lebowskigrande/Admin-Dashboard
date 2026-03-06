import { seedOperationsTasksFromTemplates, getTaskEngineHealth } from '../server/services/taskEngine.js';

const run = () => {
    const preview = seedOperationsTasksFromTemplates({ dryRun: true, rehydrate: true });
    console.log('[task-engine] operations preview summary:', preview?.summary || {});
    const applied = seedOperationsTasksFromTemplates({ rehydrate: true });
    console.log('[task-engine] operations apply summary:', applied?.summary || {});
    const health = getTaskEngineHealth();
    console.log('[task-engine] operations by origin:');
    (health?.operationsByOrigin || []).forEach((row) => {
        console.log(`  - ${row.origin_id}: ${row.active} active / ${row.total} total`);
    });
};

try {
    run();
} catch (error) {
    console.error('[task-engine] repair failed:', error);
    process.exitCode = 1;
}
