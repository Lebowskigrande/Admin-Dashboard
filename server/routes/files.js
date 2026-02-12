import express from 'express';
import { dirname, resolve } from 'path';
import { access, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { DROPBOX_ROOT } from '../helpers/file-utils.js';
import { printFile } from '../services/printService.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

const ALLOWED_ROOTS = [
    resolve(DROPBOX_ROOT)
];

const resolveAllowedPath = (rawPath) => {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const resolved = resolve(rawPath);
    const allowed = ALLOWED_ROOTS.some((root) => resolved.startsWith(root));
    return allowed ? resolved : null;
};

const openFileLocation = async (filePath) => {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
        await execFileAsync('explorer.exe', [filePath], { windowsHide: true });
        return;
    }
    const arg = `/select,${filePath}`;
    await execFileAsync('explorer.exe', [arg], { windowsHide: true });
};

router.post('/open', async (req, res) => {
    const rawPath = String(req.body?.path || '').trim();
    const resolved = resolveAllowedPath(rawPath);
    if (!resolved) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        await access(resolved);
        await openFileLocation(resolved);
        return res.json({ success: true });
    } catch (error) {
        console.error('Open file location error:', error);
        return res.status(404).json({ error: 'File not found' });
    }
});

router.get('/download', async (req, res) => {
    const rawPath = String(req.query?.path || '').trim();
    const resolved = resolveAllowedPath(rawPath);
    if (!resolved) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        await access(resolved);
        return res.sendFile(resolved);
    } catch (error) {
        console.error('Download file error:', error);
        return res.status(404).json({ error: 'File not found' });
    }
});

router.post('/print', async (req, res) => {
    const rawPath = String(req.body?.path || '').trim();
    const resolved = resolveAllowedPath(rawPath);
    if (!resolved) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        const result = await printFile(resolved, { copies: req.body?.copies });
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error('Print file error:', error);
        return res.status(500).json({ error: 'Failed to print file' });
    }
});

export default router;
