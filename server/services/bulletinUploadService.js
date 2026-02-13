import { access, mkdir, readFile, rm } from 'fs/promises';
import { basename, extname, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { format } from 'date-fns';

import { getDropboxAccessToken } from '../helpers/dropbox-utils.js';
import {
    uploadDropboxFile,
    createOrGetDropboxSharedLink,
    toDirectDropboxUrl
} from '../helpers/dropbox-client.js';
import {
    buildDocumentPreview,
    convertPubToPdf,
    resolveSofficePath,
    runSofficeConvert
} from './bulletinService.js';

const DROPBOX_BULLETINS_API_ROOT = process.env.DROPBOX_BULLETINS_API_ROOT || '/Parish Administrator/Bulletins';

const convertDocumentToPdf = async (sourcePath, outputDir) => {
    const ext = extname(sourcePath || '').toLowerCase();
    if (ext === '.pdf') return sourcePath;

    const baseName = basename(sourcePath, ext || undefined);
    const pdfPath = join(outputDir, `${baseName}.pdf`);

    if (ext === '.pub') {
        const converted = await convertPubToPdf(sourcePath, pdfPath);
        if (converted) return converted;
    }

    const sofficePath = await resolveSofficePath();
    if (!sofficePath) {
        throw new Error('LibreOffice (soffice) not found');
    }

    const converted = await runSofficeConvert(sofficePath, [
        '--headless',
        '--nologo',
        '--nodefault',
        '--norestore',
        '--convert-to',
        'pdf',
        '--outdir',
        outputDir,
        sourcePath
    ]);
    if (!converted) {
        throw new Error('Failed to convert bulletin to PDF');
    }
    return pdfPath;
};

export const uploadBulletinToDropbox = async (sourcePath) => {
    const rawPath = String(sourcePath || '').trim();
    if (!rawPath) {
        const error = new Error('path is required');
        error.statusCode = 400;
        throw error;
    }
    try {
        await access(rawPath);
    } catch {
        const error = new Error('Source bulletin file not found');
        error.statusCode = 404;
        throw error;
    }

    const token = await getDropboxAccessToken();
    if (!token) {
        const error = new Error('Dropbox not connected');
        error.statusCode = 401;
        throw error;
    }

    let tempDir = '';
    try {
        tempDir = join(tmpdir(), `bulletin-upload-${randomUUID()}`);
        await mkdir(tempDir, { recursive: true });

        const now = new Date();
        const year = String(now.getFullYear());
        const stamp = format(now, 'yyyy.MM.dd-HHmmss');
        const sourceExt = extname(rawPath || '').toLowerCase();
        const sourceBase = basename(rawPath, sourceExt || undefined);
        const safeBase = sourceBase.replace(/[<>:"/\\|?*]+/g, '').trim() || `bulletin-${stamp}`;

        const resolvedPdfPath = await convertDocumentToPdf(rawPath, tempDir);
        const pdfBytes = await readFile(resolvedPdfPath);
        const pdfDropboxPath = `${DROPBOX_BULLETINS_API_ROOT}/${year}/${safeBase}-${stamp}.pdf`;
        await uploadDropboxFile(token, pdfDropboxPath, pdfBytes, 'overwrite');
        const pdfShared = await createOrGetDropboxSharedLink(token, pdfDropboxPath);

        let imageUrl = '';
        const previewDataUrl = await buildDocumentPreview(rawPath, { force: true });
        if (previewDataUrl.startsWith('data:image/png;base64,')) {
            const previewBase64 = previewDataUrl.slice('data:image/png;base64,'.length);
            const previewBytes = Buffer.from(previewBase64, 'base64');
            const imageDropboxPath = `${DROPBOX_BULLETINS_API_ROOT}/${year}/preview/${safeBase}-${stamp}.png`;
            await uploadDropboxFile(token, imageDropboxPath, previewBytes, 'overwrite');
            const imageShared = await createOrGetDropboxSharedLink(token, imageDropboxPath);
            imageUrl = toDirectDropboxUrl(imageShared, 'image');
        }

        return {
            success: true,
            url: toDirectDropboxUrl(pdfShared, 'file'),
            imageUrl
        };
    } finally {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true }).catch(() => { });
        }
    }
};
