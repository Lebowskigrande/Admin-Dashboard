import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';
import { promisify } from 'util';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const execFileAsync = promisify(execFile);

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173/';
const serverHealthUrl = process.env.SERVER_HEALTH_URL || 'http://localhost:3001/api/health';
const clientPort = Number(process.env.CLIENT_PORT || 5173);
const serverPort = Number(process.env.SERVER_PORT || 3001);

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

const listPidsByPort = async (port) => {
    if (!Number.isFinite(port) || port <= 0) return [];
    const ps = `
$port = ${port}
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { '' }
else { ($conns | Select-Object -ExpandProperty OwningProcess) | ConvertTo-Json -Compress }
`;
    try {
        const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], {
            windowsHide: true
        });
        const raw = stdout.trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
    } catch {
        // Fall through to netstat fallback when CIM-based query is blocked.
    }

    try {
        const { stdout } = await execFileAsync('cmd.exe', ['/c', 'netstat', '-ano', '-p', 'tcp'], {
            windowsHide: true
        });
        const lines = String(stdout || '').split(/\r?\n/);
        const needle = `:${port}`;
        const pids = new Set();
        lines.forEach((line) => {
            const text = line.trim();
            if (!text) return;
            if (!text.toUpperCase().includes('LISTENING')) return;
            if (!text.includes(needle)) return;
            const parts = text.split(/\s+/);
            const pidRaw = parts[parts.length - 1];
            const pid = Number(pidRaw);
            if (Number.isFinite(pid) && pid > 0) {
                pids.add(pid);
            }
        });
        return Array.from(pids);
    } catch {
        return [];
    }
};

const killPid = async (pid) => {
    if (!pid || pid === process.pid) return;
    try {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        console.log(`[dev:both] stopped PID ${pid}`);
    } catch {
        // ignore if the process exited between list and kill
    }
};

const cleanupPorts = async (ports) => {
    const pids = new Set();
    for (const port of ports) {
        const portPids = await listPidsByPort(port);
        portPids.forEach((pid) => pids.add(pid));
    }
    for (const pid of pids) {
        await killPid(pid);
    }
};

const startServices = async () => {
    await cleanupPorts([serverPort, clientPort]);
    const [clientUp, serverUp] = await Promise.all([checkUrl(clientUrl), checkUrl(serverHealthUrl)]);

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
