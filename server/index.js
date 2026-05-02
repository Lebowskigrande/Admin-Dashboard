import dotenv from 'dotenv';

import { runBootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { runTaskMaintenance } from './services/taskEngine.js';
import { startSharefilePoller } from './services/sharefilePoller.js';

dotenv.config({ path: './server/.env' });

runBootstrap();

const PORT = Number(process.env.SERVER_PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const TASK_MAINTENANCE_INTERVAL_MS = Math.max(
    60_000,
    Number(process.env.TASK_ENGINE_MAINTENANCE_INTERVAL_MS || (15 * 60 * 1000))
);

const app = createApp({ clientOrigin: CLIENT_ORIGIN });

const startTaskMaintenancePoller = () => {
    const timer = setInterval(() => {
        try {
            const result = runTaskMaintenance();
            const operations = result?.seeded?.operations || null;
            const changed = Number(operations?.create || 0) + Number(operations?.update || 0) + Number(operations?.reactivate || 0);
            if (changed > 0) {
                console.log(`[task-engine] maintenance applied ${changed} operations seed change${changed === 1 ? '' : 's'}`);
            }
        } catch (error) {
            console.error('[task-engine] maintenance failed:', error);
        }
    }, TASK_MAINTENANCE_INTERVAL_MS);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }
    return timer;
};

app.listen(PORT, async () => {
    startTaskMaintenancePoller();
    const poller = await startSharefilePoller();
    console.log(`API Server running on http://localhost:${PORT}`);
    console.log(`[task-engine] maintenance poller active every ${Math.round(TASK_MAINTENANCE_INTERVAL_MS / 60000)} min`);
    if (poller) {
        console.log(`ShareFile poller active for labels: ${poller.labels.join(', ')}`);
    }
});
