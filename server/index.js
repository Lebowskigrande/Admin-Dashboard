import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { addMonths, format, isSunday, parseISO } from 'date-fns';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { join, dirname, resolve, basename, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

import tasksRouter from './routes/tasks.js';
import eventsRouter from './routes/events.js';


import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import xlsx from 'xlsx';
import { sqlite } from './db.js';
import { runMigrations } from './db/migrate.js';
import { seedNormalized } from './db/seedNormalized.js';
import { migrateLegacyData } from './db/legacy_migrate.js';
import { applyDefaultSundayAssignments, ensureDefaultSundayServices } from './db/default_services.js';
import { seedDatabase } from './seed.js';
import { createOAuthClient, getAuthUrl, getTokensFromCode, setStoredCredentials, GOOGLE_SCOPES } from './googleAuth.js';
import { fetchGoogleCalendarEvents, fetchCalendarList } from './googleCalendar.js';
import { google } from 'googleapis';
import { syncGoogleEvents } from './eventEngine.js';

import peopleRouter from './routes/people.js';
import {
    tableExists,
    tableHasColumn,
    coerceJsonArray,
    coerceJsonObject,
    parseJsonField,
    ensureUniqueId,
    parseNotes
} from './helpers/db-utils.js';
import {
    normalizeName,
    slugifyName,
    normalizePersonName,
    normalizeRoleToken,
    normalizePersonRoles,
    normalizeTags
} from './helpers/people-utils.js';
import authRouter from './routes/auth.js';
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

import { getDropboxAccessToken } from './helpers/dropbox-utils.js';


import {
    findBulletinFile,
    findInsertFile,
    getIsoWeekNumber,
    DROPBOX_ROOT,
    DROPBOX_BULLETINS_DIR,
    DROPBOX_INSERTS_DIR,
    DROPBOX_EVENT_DOCS_DIR
} from './helpers/file-utils.js';



import { seedTaskEngine } from './services/taskEngine.js';
import { routeShareFileEmails } from './services/sharefileEmailRouter.js';





import {
    parseCookies,
    setSessionCookie,
    clearSessionCookie,
    setCcStateCookie,
    loadSessionUser,
    requireAuth,
    SESSION_COOKIE,
    SESSION_TTL_DAYS,
    CC_STATE_COOKIE
} from './helpers/auth.js';


dotenv.config({ path: './server/.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backupDir = process.env.DB_BACKUP_DIR || 'C:\\Users\\jclar\\Dropbox\\Parish Administrator';
const backupPattern = /^church-db-.*\.db$/;

async function findLatestDbBackup() {
    try {
        const entries = await readdir(backupDir);
        const backups = await Promise.all(
            entries
                .filter(f => backupPattern.test(f))
                .map(async f => {
                    const fullPath = join(backupDir, f);
                    const stats = await stat(fullPath);
                    return { path: fullPath, name: f, mtime: stats.mtimeMs };
                })
        );
        if (backups.length === 0) return null;
        backups.sort((a, b) => b.mtime - a.mtime);
        return backups[0];
    } catch (error) {
        console.error('Failed to find backups:', error);
        return null;
    }
}




const execFileAsync = promisify(execFile);
const dbPath = join(__dirname, 'church.db');
const DEPOSIT_OUTPUT_DIR = join(__dirname, 'deposit-outputs');
const PREVIEW_CACHE_ROOT = join(__dirname, 'preview-cache');

const app = express();
const PORT = 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const upload = multer({ dest: join(tmpdir(), 'deposit-slip-uploads') });
const depositBundleUpload = multer({ dest: join(tmpdir(), 'deposit-slip-bundle-uploads') });
const vestryUpload = multer({ dest: join(tmpdir(), 'vestry-packet-uploads') });


app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});



app.use((req, _res, next) => {
    req.user = loadSessionUser(req);
    next();
});





// Run migrations and seeds
runMigrations();
seedDatabase();
seedNormalized();
migrateLegacyData();
ensureDefaultSundayServices();
seedTaskEngine();


const db = sqlite;

// Sunday and bulletin helpers migrated to modular files.






const TICKET_STATUSES = ['new', 'reviewed', 'in_process', 'closed'];

// --- Google Calendar OAuth Routes ---



app.use('/api', authRouter);



// File management routes moved to separate concerns where applicable.





// --- People Management ---


app.use('/api/people', peopleRouter);
app.use('/api', buildingsRouter);
app.use(googleRouter);
app.use(dropboxRouter);
app.use(youtubeRouter);
app.use(hgkRouter);
app.use(communicationsRouter);
app.use('/api/deposit-slip', financeRouter);
app.use('/api/vestry', vestryRouter);
app.use('/api', sundayRouter);
app.use('/api/sunday', sundayRouter);
app.use('/api/files', filesRouter);
app.use('/api', sharefileRouter);
app.use(sharefileRouter);
app.use('/api', tasksRouter);
app.use('/api', eventsRouter);



// --- Buildings & Grounds ---




// --- Buildings & Grounds ---


app.get('/api/db-backups/latest', async (req, res) => {
    try {
        const latest = await findLatestDbBackup();
        if (!latest) {
            return res.status(404).json({ error: 'No database backups found' });
        }
        res.json(latest);
    } catch (error) {
        console.error('Failed to fetch latest db backup:', error);
        res.status(500).json({ error: 'Failed to fetch latest db backup' });
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

        const dbPath = join(__dirname, 'church.db');
        sqlite.close();
        await copyFile(resolvedTarget, dbPath);

        res.json({
            success: true,
            restored: resolvedTarget,
            restartRequired: true
        });

        setTimeout(() => process.exit(0), 250);
    } catch (error) {
        console.error('Failed to restore db backup:', error);
        res.status(500).json({ error: 'Failed to restore database backup' });
    }
});

// --- dev restart ---

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
        res.json({ ok: true });
    } catch (error) {
        console.error('Restart error:', error);
        res.status(500).json({ error: 'Failed to restart dev services' });
    }
});



app.post('/api/people/backup-db', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});

// ShareFile email routing (polling)

const sharefilePollingEnabled = String(process.env.SHAREFILE_ROUTER_ENABLED || '1') !== '0';
const sharefilePollingMs = Number(process.env.SHAREFILE_ROUTER_INTERVAL_MS) || 5 * 60 * 1000;

if (sharefilePollingEnabled) {
    const runSharefilePoll = async () => {
        try {
            await routeShareFileEmails({ archive: true });
        } catch (error) {
            console.error('ShareFile email router error:', error);
        }
    };
    runSharefilePoll();
    setInterval(runSharefilePoll, sharefilePollingMs);
}
