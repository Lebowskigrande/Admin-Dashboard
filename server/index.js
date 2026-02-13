import dotenv from 'dotenv';

import { runBootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { startSharefilePoller } from './services/sharefilePoller.js';
import { assertRuntimeConfig } from './config/runtimeConfig.js';

dotenv.config({ path: './server/.env' });

const configResult = assertRuntimeConfig(process.env);
if (configResult.warnings.length > 0) {
    console.warn('Configuration warnings:');
    configResult.warnings.forEach((warning) => console.warn(` - ${warning}`));
}

runBootstrap();

const PORT = Number(process.env.SERVER_PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = createApp({ clientOrigin: CLIENT_ORIGIN });

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});

startSharefilePoller();
