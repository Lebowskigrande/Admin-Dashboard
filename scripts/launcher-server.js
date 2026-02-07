import http from 'http';
import { spawn } from 'child_process';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { appendFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const port = Number(process.env.LAUNCHER_PORT || 7350);
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173/';
const serverHealthUrl = process.env.SERVER_HEALTH_URL || 'http://localhost:3001/api/health';

const logPath = join(projectRoot, 'scripts', 'launcher.log');

const logLine = async (message) => {
    const stamp = new Date().toISOString();
    await appendFile(logPath, `[${stamp}] ${message}\n`).catch(() => {});
};

const spawnCombinedWindow = () => {
    const args = ['/c', 'start', '""', 'cmd.exe', '/k', 'node', 'scripts\\dev-both.js'];
    const child = spawn('cmd.exe', args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: projectRoot
    });
    child.on('error', (error) => {
        logLine(`spawn error: ${error?.message || error}`);
    });
    child.unref();
    logLine('spawned combined services window');
};

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

const getStatus = async () => {
    const [clientUp, serverUp] = await Promise.all([
        checkUrl(clientUrl),
        checkUrl(serverHealthUrl)
    ]);
    return { clientUp, serverUp };
};

const ensureStarted = async () => {
    const status = await getStatus();
    if (!status.serverUp || !status.clientUp) {
        spawnCombinedWindow();
    }
    return status;
};

const launcherHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Start Dashboard</title>
  <style>
    :root {
      color-scheme: light;
    }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: radial-gradient(circle at top, #f7fafc, #e2e8f0);
      color: #0f172a;
      display: grid;
      place-items: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      padding: 32px 36px;
      border-radius: 16px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.15);
      text-align: center;
      width: min(420px, calc(100vw - 32px));
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    p {
      margin: 0 0 20px;
      color: #475569;
    }
    button {
      border: 0;
      background: #1d4ed8;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      padding: 12px 18px;
      border-radius: 10px;
      cursor: pointer;
    }
    button[disabled] {
      opacity: 0.6;
      cursor: progress;
    }
    .status {
      margin-top: 16px;
      font-size: 14px;
      color: #334155;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Start Dashboard</h1>
    <p>Launch the client + server and redirect automatically.</p>
    <button id="startBtn">Start Dashboard</button>
    <div class="status" id="status">Checking services...</div>
  </div>
  <script>
    const clientUrl = ${JSON.stringify(clientUrl)};
    const statusEl = document.getElementById('status');
    const startBtn = document.getElementById('startBtn');

    const pollStatus = async () => {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        statusEl.textContent = \`Client: \${data.clientUp ? 'up' : 'down'} | Server: \${data.serverUp ? 'up' : 'down'}\`;
        if (data.clientUp && data.serverUp) {
          window.location.href = clientUrl;
          return true;
        }
      } catch {
        statusEl.textContent = 'Helper is running...';
      }
      return false;
    };

    const startServices = async () => {
      startBtn.disabled = true;
      statusEl.textContent = 'Starting services...';
      try {
        await fetch('/start', { method: 'POST' });
      } catch {
        statusEl.textContent = 'Failed to start services.';
        startBtn.disabled = false;
        return;
      }
      startBtn.disabled = false;
      const initialReady = await pollStatus();
      if (!initialReady) {
        statusEl.textContent = 'Services are down. Retrying...';
      }
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        const ready = await pollStatus();
        if (ready || attempts > 60) {
          clearInterval(timer);
          if (!ready) {
            statusEl.textContent = 'Still starting... you can retry.';
            startBtn.disabled = false;
          }
        }
      }, 1000);
    };

    startBtn.addEventListener('click', startServices);
    pollStatus();
  </script>
</body>
</html>`;

const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
};

const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(launcherHtml);
        return;
    }
    if (req.method === 'GET' && req.url === '/status') {
        const status = await getStatus();
        sendJson(res, 200, status);
        return;
    }
    if (req.method === 'POST' && req.url === '/start') {
        const status = await ensureStarted();
        sendJson(res, 200, { ok: true, ...status });
        return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

server.listen(port, () => {
    console.log(`Dashboard launcher running on http://localhost:${port}`);
});
