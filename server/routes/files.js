import express from 'express';
import { resolve } from 'path';
import { access, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

import {
    DROPBOX_ROOT,
    resolveExistingPathWithinRoots
} from '../helpers/file-utils.js';
import { ARCHITECTURAL_RECORDS_ROOT } from '../helpers/architectural-records.js';
import { requireAdmin } from '../helpers/auth.js';
import { printFile } from '../services/printService.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

const ALLOWED_ROOTS = [
    resolve(DROPBOX_ROOT),
    resolve(ARCHITECTURAL_RECORDS_ROOT),
    resolve(process.cwd()),
    resolve('Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AR & Contributions'),
    resolve('Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AP & Expenses')
];

const resolveAllowedPath = async (rawPath) => resolveExistingPathWithinRoots(rawPath, ALLOWED_ROOTS);

const openFileLocation = async (filePath) => {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
        await execFileAsync('explorer.exe', [filePath], { windowsHide: true });
        return;
    }
    const arg = `/select,${filePath}`;
    await execFileAsync('explorer.exe', [arg], { windowsHide: true });
};

router.use(requireAdmin);

router.post('/open', async (req, res) => {
    const rawPath = String(req.body?.path || '').trim();
    const resolvedPath = await resolveAllowedPath(rawPath);
    if (!resolvedPath) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        await access(resolvedPath);
        await openFileLocation(resolvedPath);
        return res.json({ success: true });
    } catch (error) {
        console.error('Open file location error:', error);
        return res.status(404).json({ error: 'File not found' });
    }
});

router.get('/download', async (req, res) => {
    const rawPath = String(req.query?.path || '').trim();
    const resolvedPath = await resolveAllowedPath(rawPath);
    if (!resolvedPath) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        await access(resolvedPath);
        return res.sendFile(resolvedPath);
    } catch (error) {
        console.error('Download file error:', error);
        return res.status(404).json({ error: 'File not found' });
    }
});

router.post('/print', async (req, res) => {
    const rawPath = String(req.body?.path || '').trim();
    const resolvedPath = await resolveAllowedPath(rawPath);
    if (!resolvedPath) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    try {
        const result = await printFile(resolvedPath, { copies: req.body?.copies });
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error('Print file error:', error);
        return res.status(500).json({ error: 'Failed to print file' });
    }
});

export default router;
