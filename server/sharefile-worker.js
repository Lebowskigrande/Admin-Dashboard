import dotenv from 'dotenv';

import { runBootstrap } from './bootstrap.js';
import { startSharefilePoller } from './services/sharefilePoller.js';

dotenv.config({ path: './server/.env' });

runBootstrap();

const poller = await startSharefilePoller();

if (poller) {
    console.log(`ShareFile poller worker started for labels: ${poller.labels.join(', ')}`);
} else {
    console.log('ShareFile poller is disabled or already running elsewhere');
}
