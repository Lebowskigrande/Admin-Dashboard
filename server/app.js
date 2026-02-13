import express from 'express';
import cors from 'cors';
import { readFile, readdir, stat, copyFile } from 'fs/promises';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

import { sqlite } from './db.js';
import { loadSessionUser } from './helpers/auth.js';
import { getDropboxAccessToken } from './helpers/dropbox-utils.js';

import authRouter from './routes/auth.js';
import peopleRouter from './routes/people.js';
import buildingsRouter from './routes/buildings.js';
import googleRouter from './routes/google.js';
import dropboxRouter from './routes/dropbox.js';
import youtubeRouter from './routes/youtube.js';
import hgkRouter from './routes/hgk.js';
import communicationsRouter from './routes/communications.js';
import financeRouter from './routes/finance.js';
import vestryRouter from './routes/vestry.js';
import sundayRouter from './routes/sunday.js';
import filesRouter from './routes/files.js';
import sharefileRouter from './routes/sharefile.js';
import tasksRouter from './routes/tasks.js';
import eventsRouter from './routes/events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backupDir = process.env.DB_BACKUP_DIR || 'C:\\Users\\jclar\\Dropbox\\Parish Administrator';
const backupPattern = /^church-db-.*\.db$/;
const dbPath = join(__dirname, 'church.db');

const ROUTER_MOUNTS = [
    { key: 'auth', mount: '/api', router: authRouter },
    { key: 'people', mount: '/api/people', router: peopleRouter },
    { key: 'buildings', mount: '/api', router: buildingsRouter },
    { key: 'google', mount: null, router: googleRouter },
    { key: 'dropbox', mount: null, router: dropboxRouter },
    { key: 'youtube', mount: null, router: youtubeRouter },
    { key: 'hgk', mount: null, router: hgkRouter },
    { key: 'communications', mount: null, router: communicationsRouter },
    { key: 'finance', mount: '/api/deposit-slip', router: financeRouter },
    { key: 'vestry', mount: '/api/vestry', router: vestryRouter },
    { key: 'sunday', mount: '/api', router: sundayRouter },
    { key: 'files', mount: '/api/files', router: filesRouter },
    { key: 'sharefile', mount: null, router: sharefileRouter },
    { key: 'tasks', mount: '/api', router: tasksRouter },
    { key: 'events', mount: '/api', router: eventsRouter }
];

const registerRouteMounts = (app) => {
    const seenKeys = new Set();
    const seenMounts = new Set();

    for (const entry of ROUTER_MOUNTS) {
        if (seenKeys.has(entry.key)) {
            throw new Error(`Duplicate router key in mount policy: ${entry.key}`);
        }
        seenKeys.add(entry.key);

        const mountFingerprint = `${entry.key}:${entry.mount || '<root>'}`;
        if (seenMounts.has(mountFingerprint)) {
            throw new Error(`Duplicate router mount in mount policy: ${mountFingerprint}`);
        }
        seenMounts.add(mountFingerprint);

        if (entry.mount) {
            app.use(entry.mount, entry.router);
        } else {
            app.use(entry.router);
        }
    }
};

const findLatestDbBackup = async () => {
    try {
        const entries = await readdir(backupDir);
        const backups = await Promise.all(
            entries
                .filter((name) => backupPattern.test(name))
                .map(async (name) => {
                    const fullPath = join(backupDir, name);
                    const stats = await stat(fullPath);
                    return { path: fullPath, name, mtime: stats.mtimeMs };
                })
        );
        if (!backups.length) return null;
        backups.sort((a, b) => b.mtime - a.mtime);
        return backups[0];
    } catch (error) {
        console.error('Failed to find backups:', error);
        return null;
    }
};

export const createApp = ({ clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173' } = {}) => {
    const app = express();

    app.use(cors({ origin: clientOrigin, credentials: true }));
    app.use(express.json({ limit: '25mb' }));

    app.get('/api/health', (_req, res) => {
        res.json({ ok: true });
    });

    app.use((req, _res, next) => {
        req.user = loadSessionUser(req);
        next();
    });

    registerRouteMounts(app);

    app.get('/api/db-backups/latest', async (_req, res) => {
        try {
            const latest = await findLatestDbBackup();
            if (!latest) return res.status(404).json({ error: 'No database backups found' });
            return res.json(latest);
        } catch (error) {
            console.error('Failed to fetch latest db backup:', error);
            return res.status(500).json({ error: 'Failed to fetch latest db backup' });
        }
    });

    app.post('/api/db-backups/restore', async (req, res) => {
        try {
            const requestedPath = req.body?.path;
            const latest = await findLatestDbBackup();
            const target = requestedPath || latest?.path;
            if (!target) {
                return res.status(404).json({ error: 'No database backup available to restore' });
            }

            const resolvedTarget = resolve(target);
            const resolvedDir = resolve(backupDir);
            if (!resolvedTarget.startsWith(resolvedDir)) {
                return res.status(400).json({ error: 'Invalid backup path' });
            }

            const filename = basename(resolvedTarget);
            if (!backupPattern.test(filename)) {
                return res.status(400).json({ error: 'Invalid backup filename' });
            }

            sqlite.close();
            await copyFile(resolvedTarget, dbPath);

            res.json({
                success: true,
                restored: resolvedTarget,
                restartRequired: true
            });

            setTimeout(() => process.exit(0), 250);
            return undefined;
        } catch (error) {
            console.error('Failed to restore db backup:', error);
            return res.status(500).json({ error: 'Failed to restore database backup' });
        }
    });

    app.post('/api/dev/restart', (req, res) => {
        const ip = req.ip || req.connection?.remoteAddress || '';
        const isLocal = ip.includes('127.0.0.1') || ip === '::1' || ip.endsWith('::1');
        if (process.env.NODE_ENV === 'production' || !isLocal) {
            return res.status(403).json({ error: 'Restart not allowed' });
        }
        try {
            const scriptPath = resolve(__dirname, '../scripts/restart-dev.ps1');
            const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
            return res.json({ ok: true });
        } catch (error) {
            console.error('Restart error:', error);
            return res.status(500).json({ error: 'Failed to restart dev services' });
        }
    });

    app.post('/api/people/backup-db', async (_req, res) => {
        try {
            const token = await getDropboxAccessToken();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `church-db-${timestamp}.db`;
            const dropboxPath = `/Parish Administrator/Dashboard/${filename}`;
            const dbBuffer = await readFile(dbPath);
            const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/octet-stream',
                    'Dropbox-API-Arg': JSON.stringify({
                        path: dropboxPath,
                        mode: 'add',
                        autorename: true,
                        mute: false
                    })
                },
                body: dbBuffer
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Dropbox upload failed');
            }

            return res.json({ path: dropboxPath, name: filename });
        } catch (error) {
            console.error('Dropbox backup error:', error);
            return res.status(500).json({ error: error?.message || 'Failed to back up database' });
        }
    });

    return app;
};
