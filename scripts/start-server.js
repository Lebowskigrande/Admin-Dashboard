import { execFile } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const pidFile = join(projectRoot, 'server', '.server.pid');

const escapePs = (value) => String(value || '')
    .replace(/`/g, '``')
    .replace(/'/g, "''");

const listServerPidsByCommandLine = async () => {
    const ps = `
$root = '${escapePs(projectRoot)}'
$patternRoot = [Regex]::Escape($root) + '\\\\server\\\\index.js'
$patternRelative = '\\\\server\\\\index.js'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -match $patternRoot -or $_.CommandLine -match $patternRelative
        )
    } |
    Select-Object -ExpandProperty ProcessId
if ($procs) { $procs | ConvertTo-Json -Compress } else { '' }
`;
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], {
        windowsHide: true
    });
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
};

const listPidsByPort = async (port) => {
    if (!port) return [];
    const ps = `
$port = ${Number(port)}
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { '' }
else { ($conns | Select-Object -ExpandProperty OwningProcess) | ConvertTo-Json -Compress }
`;
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], {
        windowsHide: true
    });
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
};

const readPidFile = async () => {
    try {
        const raw = await readFile(pidFile, 'utf8');
        const value = Number(String(raw).trim());
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
};

const writePidFile = async (pid) => {
    try {
        await writeFile(pidFile, String(pid), 'utf8');
    } catch {
        // ignore
    }
};

const tryKill = async (pid) => {
    if (!pid || pid === process.pid) return;
    try {
        process.kill(pid, 'SIGTERM');
        return;
    } catch {
        // fall through
    }
    try {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {
        // ignore if already closed
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureCleanServer = async () => {
    const knownPid = await readPidFile();
    const pids = new Set();
    if (knownPid) pids.add(knownPid);
    const commandLinePids = await listServerPidsByCommandLine();
    commandLinePids.forEach((pid) => pids.add(pid));
    const portPids = await listPidsByPort(process.env.SERVER_PORT || 3001);
    portPids.forEach((pid) => pids.add(pid));

    for (const pid of Array.from(pids)) {
        await tryKill(pid);
    }
    if (pids.size) {
        await sleep(400);
    }
};

await ensureCleanServer();
await writePidFile(process.pid);
await import('../server/index.js');
