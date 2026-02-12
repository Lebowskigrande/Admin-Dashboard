import { join, basename, extname, dirname } from 'path';
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import PizZip from 'pizzip';
import { sqlite } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const execFileAsync = promisify(execFile);
const PREVIEW_CACHE_ROOT = join(__dirname, '..', 'preview-cache');

let cachedSofficePath = null;
let cachedPublisherAvailable = null;

export const resolveSofficePath = async () => {
    if (cachedSofficePath) return cachedSofficePath;
    const envPath = process.env.SOFFICE_PATH;
    const candidates = [
        envPath,
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            await access(candidate);
            cachedSofficePath = candidate;
            return candidate;
        } catch {
            continue;
        }
    }
    cachedSofficePath = null;
    return null;
};

export const hasPublisherCom = async () => {
    if (cachedPublisherAvailable !== null) return cachedPublisherAvailable;
    try {
        await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            "New-Object -ComObject Publisher.Application | Out-Null"
        ], { windowsHide: true });
        cachedPublisherAvailable = true;
    } catch {
        cachedPublisherAvailable = false;
    }
    return cachedPublisherAvailable;
};

export const convertPubToPdf = async (inputPath, outputPath) => {
    const canUsePublisher = await hasPublisherCom();
    if (!canUsePublisher) return null;
    const escapePath = (value) => String(value || '').replace(/'/g, "''");
    const script = [
        "$ErrorActionPreference = 'Stop';",
        '$app = New-Object -ComObject Publisher.Application;',
        '$app.Visible = $false;',
        `$doc = $app.Open('${escapePath(inputPath)}', $false, $true);`,
        `$doc.ExportAsFixedFormat('${escapePath(outputPath)}', 1);`,
        '$doc.Close();',
        '$app.Quit();'
    ].join(' ');
    try {
        await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        return outputPath;
    } catch (error) {
        const details = error?.stderr || error?.message || error;
        console.error('Publisher COM export failed:', details);
        return null;
    }
};

export const runSofficeConvert = async (sofficePath, args) => {
    try {
        await execFileAsync(sofficePath, args, { windowsHide: true });
        return true;
    } catch (error) {
        const details = error?.stderr || error?.message || error;
        console.error('Preview generation failed:', details);
        return false;
    }
};

export const normalizeBulletinStatus = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'DRAFT') return 'draft';
    if (normalized === 'REVIEW') return 'review';
    if (normalized === 'FINAL') return 'ready';
    if (normalized === 'PRINTED') return 'printed';
    if (normalized === 'READY') return 'ready';
    if (normalized === 'NOT STARTED' || normalized === 'NOT_STARTED') return 'not_started';
    return '';
};

export const readDocxCustomProperty = async (filePath, propName) => {
    try {
        const buffer = await readFile(filePath);
        const zip = new PizZip(buffer);
        const custom = zip.file('docProps/custom.xml');
        if (!custom) return '';
        const xml = custom.asText();
        const propRegex = /<property\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/property>/gi;
        let match = null;
        while ((match = propRegex.exec(xml))) {
            const name = String(match[1] || '').trim().toLowerCase();
            if (name !== String(propName || '').trim().toLowerCase()) continue;
            const body = match[2] || '';
            const valueMatch = body.match(/<vt:[^>]+>([\s\S]*?)<\/vt:[^>]+>/i);
            if (valueMatch) {
                return String(valueMatch[1] || '').replace(/<\/?[^>]+>/g, '').trim();
            }
            const fallback = body.replace(/<\/?[^>]+>/g, '').trim();
            return fallback;
        }
        return '';
    } catch (error) {
        const details = error?.message || error;
        console.error('Custom property read failed:', details);
        return '';
    }
};

export const readDocxStatus = async (filePath) => {
    const ext = extname(filePath || '').toLowerCase();
    if (!['.doc', '.docx', '.docm'].includes(ext)) return '';
    const fromXml = await readDocxCustomProperty(filePath, 'Status');
    if (fromXml) return normalizeBulletinStatus(fromXml);
    const escaped = String(filePath || '').replace(/'/g, "''");
    const script = [
        "$ErrorActionPreference = 'Stop';",
        '$word = New-Object -ComObject Word.Application;',
        '$word.Visible = $false;',
        '$word.DisplayAlerts = 0;',
        `$doc = $word.Documents.Open('${escaped}', $false, $true);`,
        "$value = ''",
        'try {',
        '  foreach ($prop in $doc.CustomDocumentProperties) {',
        "    if ($prop.Name -and $prop.Name.ToString().Trim().ToLower() -eq 'status') {",
        '      $value = $prop.Value;',
        '      break;',
        '    }',
        '  }',
        '} catch { }',
        '$doc.Close($false);',
        '$word.Quit();',
        '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null;',
        '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null;',
        'Write-Output $value'
    ].join(' ');
    try {
        const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        return normalizeBulletinStatus(stdout || '');
    } catch (error) {
        const details = error?.stderr || error?.message || error;
        console.error('Bulletin status metadata read failed:', details);
        return '';
    }
};

export const buildDocumentPreview = async (filePath, options = {}) => {
    const { force = false } = options;
    const cacheRoot = PREVIEW_CACHE_ROOT;
    const outputDir = join(tmpdir(), `preview-${randomUUID()}`);
    const ext = extname(filePath || '').toLowerCase();
    try {
        const sofficePath = await resolveSofficePath();
        if (!sofficePath) {
            throw new Error('soffice not found');
        }
        await mkdir(cacheRoot, { recursive: true });
        const stats = await stat(filePath);
        const cacheKey = createHash('sha1')
            .update(`${filePath}:${stats.mtimeMs}:${stats.size}`)
            .digest('hex');
        const cachedPreview = join(cacheRoot, `${cacheKey}.png`);
        if (!force) {
            try {
                await access(cachedPreview);
                const cachedData = await readFile(cachedPreview);
                return `data:image/png;base64,${cachedData.toString('base64')}`;
            } catch {
                // Cache miss, generate preview.
            }
        }

        await mkdir(outputDir, { recursive: true });
        const baseArgs = [
            '--headless',
            '--nologo',
            '--nodefault',
            '--norestore'
        ];
        const pdfPath = join(outputDir, `${basename(filePath, ext)}.pdf`);
        let pdfReady = false;

        if (ext === '.pub') {
            const converted = await convertPubToPdf(filePath, pdfPath);
            if (converted) {
                pdfReady = true;
            } else {
                const pdfArgs = [
                    ...baseArgs,
                    '--convert-to',
                    'pdf',
                    '--outdir',
                    outputDir,
                    filePath
                ];
                pdfReady = await runSofficeConvert(sofficePath, pdfArgs);
            }
        } else {
            const pdfArgs = [
                ...baseArgs,
                '--convert-to',
                'pdf',
                '--outdir',
                outputDir,
                filePath
            ];
            pdfReady = await runSofficeConvert(sofficePath, pdfArgs);
        }

        if (!pdfReady) return '';

        const pdfPngArgs = [
            ...baseArgs,
            '--convert-to',
            'png:draw_png_Export:Resolution=72',
            '--outdir',
            outputDir,
            pdfPath
        ];
        const converted = await runSofficeConvert(sofficePath, pdfPngArgs);
        if (!converted) return '';
        const files = await readdir(outputDir);
        const pngFile = files
            .filter((name) => name.toLowerCase().endsWith('.png'))
            .sort()[0];
        if (!pngFile) return '';
        const generatedPath = join(outputDir, pngFile);
        await copyFile(generatedPath, cachedPreview).catch(() => { });
        const data = await readFile(cachedPreview);
        return `data:image/png;base64,${data.toString('base64')}`;
    } catch (error) {
        console.error('Preview generation failed:', error?.message || error);
        return '';
    } finally {
        await rm(outputDir, { recursive: true, force: true }).catch(() => { });
    }
};

export const buildDocumentStatus = async (filePath, options = {}) => {
    const { includePreview = true, statusOverride = '', forcePreview = false } = options;
    if (!filePath) {
        return { exists: false, preview: '', path: '', name: '', status: '' };
    }
    try {
        await access(filePath);
    } catch {
        return { exists: false, preview: '', path: filePath, name: basename(filePath), status: '' };
    }
    const status = statusOverride || await readDocxStatus(filePath);
    const preview = includePreview ? await buildDocumentPreview(filePath, { force: forcePreview }) : '';
    return {
        exists: true,
        preview,
        path: filePath,
        name: basename(filePath),
        status
    };
};

export const hasBulletinStatusTable = () => !!sqlite.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bulletin_status'
`).get();

export const getBulletinStatus = (dateKey, docKey) => {
    if (!dateKey || !docKey || !hasBulletinStatusTable()) return '';
    const row = sqlite.prepare(`
        SELECT status FROM bulletin_status WHERE date = ? AND doc_key = ?
    `).get(dateKey, docKey);
    return row?.status || '';
};

export const upsertBulletinStatus = (dateKey, docKey, status, source = 'metadata') => {
    if (!dateKey || !docKey || !hasBulletinStatusTable()) return;
    const normalized = normalizeBulletinStatus(status);
    if (!normalized) return;
    sqlite.prepare(`
        INSERT INTO bulletin_status (date, doc_key, status, source, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(date, doc_key) DO UPDATE SET
            status = excluded.status,
            source = excluded.source,
            updated_at = excluded.updated_at
    `).run(dateKey, docKey, normalized, source, new Date().toISOString());
};

export const clearBulletinStatus = (dateKey, docKey) => {
    if (!dateKey || !docKey || !hasBulletinStatusTable()) return;
    sqlite.prepare(`
        DELETE FROM bulletin_status WHERE date = ? AND doc_key = ?
    `).run(dateKey, docKey);
};
