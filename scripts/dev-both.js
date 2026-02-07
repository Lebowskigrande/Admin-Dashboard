import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173/';
const serverHealthUrl = process.env.SERVER_HEALTH_URL || 'http://localhost:3001/api/health';

const checkUrl = async (url, timeoutMs = 750) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return !!response;
    } catch {
        clearTimeout(timer);
        return false;
    }
};

const spawnChild = (args, label) => {
    const child = spawn(process.execPath, args, {
        cwd: projectRoot,
        stdio: 'inherit'
    });
    child.on('exit', (code) => {
        console.log(`[${label}] exited with code ${code ?? 'unknown'}`);
    });
    return child;
};

const startServices = async () => {
    const [clientUp, serverUp] = await Promise.all([
        checkUrl(clientUrl),
        checkUrl(serverHealthUrl)
    ]);

    const children = [];

    if (!serverUp) {
        children.push(spawnChild(['scripts/start-server.js'], 'server'));
    } else {
        console.log('[server] already running');
    }

    if (!clientUp) {
        const viteBin = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
        try {
            await access(viteBin);
            children.push(spawnChild([viteBin], 'client'));
        } catch {
            children.push(spawnChild(['node_modules/vite/bin/vite.js'], 'client'));
        }
    } else {
        console.log('[client] already running');
    }

    if (children.length === 0) {
        console.log('Both services are already running.');
        return;
    }

    const shutdown = () => {
        children.forEach((child) => {
            if (!child.killed) {
                child.kill('SIGINT');
            }
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

startServices();
