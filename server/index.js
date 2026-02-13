import dotenv from 'dotenv';

import { runBootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { startSharefilePoller } from './services/sharefilePoller.js';

dotenv.config({ path: './server/.env' });

runBootstrap();

const PORT = Number(process.env.SERVER_PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = createApp({ clientOrigin: CLIENT_ORIGIN });

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});

startSharefilePoller();
