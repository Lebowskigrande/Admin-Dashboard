import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { join, extname, dirname } from 'path';
import { mkdir, writeFile, rm, readFile, stat, copyFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { chromium } from 'playwright';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { format as formatDate } from 'date-fns';

import { createOAuthClient, setStoredCredentials } from '../googleAuth.js';
import { getSharefileGmailTokens } from '../helpers/auth.js';
import { sqlite as db } from '../db.js';
import {
    extractGmailMessageText,
    sanitizeFileSegment,
    decodeGmailBody,
    collectGmailParts
} from '../helpers/hgk-utils.js';

const DEFAULT_ROOT = 'Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AR & Contributions\\james - temp test';
const PROCESSED_LABEL = 'ShareFile Routed';
const execFileAsync = promisify(execFile);
const DEFAULT_BASES = {
    budget: DEFAULT_ROOT,
    envelope: DEFAULT_ROOT
};

const getBaseDirectories = () => {
    const raw = process.env.SHAREFILE_ROUTER_BASES || '';
    if (!raw) return DEFAULT_BASES;
    try {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_BASES, ...parsed };
    } catch {
        // Fallback for .env values that contain unescaped Windows backslashes.
        // Example:
        // {"budget":"Y:\Folders\...\Test AP","envelope":"Y:\Folders\...\Test AR"}
        const extracted = {};
        const pattern = /"(budget|envelope)"\s*:\s*"([^"]*)"/gi;
        let match = pattern.exec(raw);
        while (match) {
            const key = String(match[1] || '').toLowerCase();
            const value = String(match[2] || '').trim();
            if (key && value) extracted[key] = value;
            match = pattern.exec(raw);
        }
        return Object.keys(extracted).length
            ? { ...DEFAULT_BASES, ...extracted }
            : DEFAULT_BASES;
    }
};

const ensureLabel = async (gmail, name) => {
    const listResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = Array.isArray(listResponse.data.labels) ? listResponse.data.labels : [];
    const existing = labels.find((label) => label.name === name);
    if (existing?.id) return existing.id;
    const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show'
        }
    });
    return created.data.id;
};

const getGmailClient = (tokens) => {
    const client = createOAuthClient();
    setStoredCredentials(client, tokens);
    return google.gmail({ version: 'v1', auth: client });
};

const collectAttachments = (part, collected = []) => {
    if (!part) return collected;
    if (part.filename && part.body?.attachmentId) {
        collected.push({
            filename: part.filename,
            attachmentId: part.body.attachmentId,
            mimeType: part.mimeType || ''
        });
    }
    if (Array.isArray(part.parts)) {
        part.parts.forEach((child) => collectAttachments(child, collected));
    }
    return collected;
};

const parseEmailMetadata = (message) => {
    const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
    const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name)?.value || '';
    const subject = getHeader('subject');
    const from = getHeader('from');
    const date = getHeader('date');
    return { subject, from, date };
};

const decodeAttachmentData = (data) => {
    if (!data) return Buffer.from('');
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
};

const buildNoteText = (_metadata, extra = {}) => {
    const code = String(extra?.codeValue || '').trim() || 'unknown';
    const timestamp = extra?.clientTs ? new Date(extra.clientTs) : new Date();
    const date = timestamp.toLocaleDateString();
    const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Budget code: ${code}. Approved by James Clark on ${date} at ${time}.`;
};

const normalizeRouteKind = (value) => {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'DB') return 'DB';
    if (upper === 'CONTRIBUTION') return 'CONTRIBUTION';
    return 'BILL';
};

const ensureUniquePath = async (dir, filename) => {
    const base = filename.replace(/\.pdf$/i, '');
    const ext = '.pdf';
    let candidate = `${base}${ext}`;
    let counter = 2;
    while (true) {
        try {
            await access(join(dir, candidate));
            candidate = `${base}-${counter}${ext}`;
            counter += 1;
        } catch {
            return { filename: candidate, targetPath: join(dir, candidate) };
        }
    }
};

const buildInvoiceFilename = async ({
    kind,
    timestamp,
    targetDir
}) => {
    const time = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
        ? timestamp
        : new Date();
    const yearMonth = formatDate(time, 'yyyy.MM');
    const hhmmss = formatDate(time, 'HHmmss');
    const baseName = `${yearMonth} SEEC ${kind} ${hhmmss}`;
    return ensureUniquePath(targetDir, baseName);
};

const renderEmailToPdf = async (metadata, bodyText) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage();
    let { width, height } = page.getSize();
    const margin = 50;
    const lineHeight = 14;
    let cursorY = height - margin;

    const title = metadata?.subject || 'Email';
    page.drawText(title, { x: margin, y: cursorY, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
    cursorY -= lineHeight * 2;

    const lines = String(bodyText || '').split(/\r?\n/);
    lines.forEach((line) => {
        if (cursorY < margin) {
            page = doc.addPage();
            ({ width, height } = page.getSize());
            cursorY = height - margin;
        }
        page.drawText(line, { x: margin, y: cursorY, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
        cursorY -= lineHeight;
    });

    return doc.save();
};

const extractGmailMessageHtml = (message) => {
    const payload = message?.payload;
    if (!payload) return '';
    const htmlParts = collectGmailParts(payload, 'text/html');
    if (htmlParts.length > 0) {
        return htmlParts.map(decodeGmailBody).join('\n');
    }
    return '';
};

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildEmailHtml = (metadata, htmlBody, fallbackText) => {
    const subject = escapeHtml(metadata?.subject || 'Email');
    const from = escapeHtml(metadata?.from || '');
    const date = escapeHtml(metadata?.date || '');
    const body = htmlBody
        ? htmlBody
        : `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(fallbackText || '')}</pre>`;
    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${subject}</title>
            <style>
                body { font-family: "Segoe UI", Arial, sans-serif; color: #1f2933; margin: 32px; }
                .header { border-bottom: 1px solid #d9dee2; padding-bottom: 12px; margin-bottom: 16px; }
                .subject { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
                .meta { font-size: 12px; color: #5b6770; }
                .meta span { display: block; margin-top: 2px; }
                .body { font-size: 13px; line-height: 1.45; }
                img { max-width: 100%; height: auto; }
                table { border-collapse: collapse; max-width: 100%; }
                td, th { border: 1px solid #e1e6ea; padding: 6px 8px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="subject">${subject}</div>
                <div class="meta">
                    ${from ? `<span><strong>From:</strong> ${from}</span>` : ''}
                    ${date ? `<span><strong>Date:</strong> ${date}</span>` : ''}
                </div>
            </div>
            <div class="body">${body}</div>
        </body>
        </html>
    `;
};

const renderEmailHtmlToPdf = async (html) => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
        if (typeof page.emulateMediaType === 'function') {
            await page.emulateMediaType('screen');
        } else if (typeof page.emulateMedia === 'function') {
            await page.emulateMedia({ media: 'screen' });
        }
        const pdfBuffer = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' }
        });
        return pdfBuffer;
    } finally {
        await browser.close();
    }
};

const addNoteToPdf = async (pdfBytes, noteText) => {
    const doc = await PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const margin = 36;
    pages.forEach((page) => {
        const { width } = page.getSize();
        page.drawText(noteText, {
            x: margin,
            y: margin,
            size: 9,
            font,
            color: rgb(0.2, 0.2, 0.2),
            maxWidth: width - margin * 2
        });
    });
    const page = pages[0] || doc.addPage();
    const annotation = doc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Text'),
        Rect: [margin, margin, margin + 1, margin + 1],
        Contents: PDFString.of(noteText),
        Name: PDFName.of('Comment'),
        Open: false
    });
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
        annots.push(annotation);
    } else {
        page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
    }
    return doc.save();
};

const moveFileSafe = async (sourcePath, targetPath) => {
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    await unlink(sourcePath);
};

const convertToPdfIfNeeded = async (sourcePath, outDir) => {
    const ext = extname(sourcePath).toLowerCase();
    if (ext === '.pdf') return sourcePath;
    const soffice = 'soffice';
    try {
        await execFileAsync(soffice, [
            '--headless',
            '--convert-to',
            'pdf',
            '--outdir',
            outDir,
            sourcePath
        ], { windowsHide: true });
        const candidate = sourcePath.replace(ext, '.pdf');
        const exists = await stat(candidate).then(() => true).catch(() => false);
        if (exists) return candidate;
    } catch {
        // fall through to placeholder
    }
    const placeholder = await PDFDocument.create();
    const font = await placeholder.embedFont(StandardFonts.Helvetica);
    const page = placeholder.addPage();
    page.drawText('Attachment conversion placeholder', { x: 50, y: 700, size: 14, font });
    page.drawText(`Original file: ${sourcePath}`, { x: 50, y: 680, size: 10, font });
    const placeholderBytes = await placeholder.save();
    const targetPath = join(outDir, `${sanitizeFileSegment(sourcePath)}.pdf`);
    await writeFile(targetPath, placeholderBytes);
    return targetPath;
};

const buildTargetDir = ({ codeType }) => {
    const bases = getBaseDirectories();
    return bases[codeType] || DEFAULT_ROOT;
};

const getSharefileJob = (messageId, codeType, codeValue) => {
    if (!messageId) return null;
    return db.prepare(`
        SELECT * FROM sharefile_jobs
        WHERE message_id = ? AND code_type = ? AND code_value = ?
        LIMIT 1
    `).get(messageId, codeType || '', codeValue || '');
};

const saveSharefileJob = ({ messageId, threadId, codeType, codeValue, output }) => {
    const now = new Date().toISOString();
    const id = `job-${randomUUID()}`;
    db.prepare(`
        INSERT INTO sharefile_jobs (id, message_id, thread_id, code_type, code_value, output_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        messageId,
        threadId || null,
        codeType || '',
        codeValue || '',
        JSON.stringify(output || {}),
        now
    );
    return { id, created_at: now };
};

export const recordSharefileRoutingEvent = ({
    jobId = null,
    messageId = null,
    threadId = null,
    codeType = '',
    codeValue = '',
    status = 'success',
    errorText = '',
    output = null
} = {}) => {
    try {
        const id = `job-event-${randomUUID()}`;
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO sharefile_job_events (
                id, job_id, message_id, thread_id, code_type, code_value, status, error_text, output_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            jobId || null,
            messageId || null,
            threadId || null,
            codeType || '',
            codeValue || '',
            status || 'success',
            errorText || '',
            output ? JSON.stringify(output) : null,
            now
        );
        return { id, created_at: now };
    } catch (error) {
        console.warn('Failed to record sharefile routing event:', error);
        return null;
    }
};

export const routeShareFileEmails = async ({
    rootPath = DEFAULT_ROOT,
    archive = true
} = {}) => {
    const tokens = getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }

    const client = createOAuthClient();
    setStoredCredentials(client, tokens);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const labelId = await ensureLabel(gmail, PROCESSED_LABEL);

    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: `label:inbox -label:"${PROCESSED_LABEL}"`
    });
    const messages = Array.isArray(listResponse.data.messages) ? listResponse.data.messages : [];
    if (messages.length === 0) return { processed: 0 };

    await mkdir(rootPath, { recursive: true });
    let processed = 0;

    for (const entry of messages) {
        const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: entry.id,
            format: 'full'
        });
        const message = messageResponse.data;
        const metadata = parseEmailMetadata(message);
        const noteText = buildNoteText(metadata);
        const attachments = collectAttachments(message.payload);
        const routingTimestamp = new Date(Number(message?.internalDate) || Date.now());

        const tempDir = join(tmpdir(), `sharefile-${randomUUID()}`);
        await mkdir(tempDir, { recursive: true });
        const outputs = [];

        try {
            if (attachments.length === 0) {
                const bodyText = extractGmailMessageText(message) || message.snippet || '';
                const htmlBody = extractGmailMessageHtml(message);
                let pdfBytes;
                try {
                    const html = buildEmailHtml(metadata, htmlBody, bodyText);
                    pdfBytes = await renderEmailHtmlToPdf(html);
                } catch (error) {
                    console.warn('HTML email render failed, falling back to text PDF:', error);
                    pdfBytes = await renderEmailToPdf(metadata, bodyText);
                }
                const { filename, targetPath } = await buildInvoiceFilename({
                    kind: 'BILL',
                    timestamp: routingTimestamp,
                    targetDir: rootPath
                });
                const notedBytes = await addNoteToPdf(pdfBytes, noteText);
                const tempPath = join(tempDir, filename);
                await writeFile(tempPath, notedBytes);
                await moveFileSafe(tempPath, targetPath);
                outputs.push(targetPath);
            } else {
                let index = 0;
                for (const attachment of attachments) {
                    const attachmentResponse = await gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: entry.id,
                        id: attachment.attachmentId
                    });
                    const data = attachmentResponse.data?.data;
                    if (!data) continue;
                    const rawBytes = decodeAttachmentData(data);
                    const sourcePath = join(tempDir, attachment.filename || `attachment-${index}`);
                    await writeFile(sourcePath, rawBytes);
                    const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                    const pdfBytes = await readFile(pdfPath);
                    const { filename, targetPath } = await buildInvoiceFilename({
                        kind: 'BILL',
                        timestamp: routingTimestamp,
                        targetDir: rootPath
                    });
                    const notedBytes = await addNoteToPdf(pdfBytes, noteText);
                    const tempPath = join(tempDir, filename);
                    await writeFile(tempPath, notedBytes);
                    await moveFileSafe(tempPath, targetPath);
                    outputs.push(targetPath);
                    index += 1;
                }
            }

            const threadId = message.threadId || '';
            if (threadId) {
                await gmail.users.threads.modify({
                    userId: 'me',
                    id: threadId,
                    requestBody: {
                        addLabelIds: [labelId],
                        removeLabelIds: archive ? ['INBOX'] : []
                    }
                });
            } else {
                await gmail.users.messages.modify({
                    userId: 'me',
                    id: entry.id,
                    requestBody: {
                        addLabelIds: [labelId],
                        removeLabelIds: archive ? ['INBOX'] : []
                    }
                });
            }
            processed += 1;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }

    return { processed };
};

export const resolveSharefileMessageId = async (threadId, tokensOverride = null) => {
    const tokens = tokensOverride || getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }
    if (!threadId) return null;
    const gmail = getGmailClient(tokens);
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata' });
    const messages = Array.isArray(thread.data?.messages) ? thread.data.messages : [];
    if (messages.length === 0) return null;
    const latest = messages
        .slice()
        .sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))
        .pop();
    return latest?.id || null;
};

export const routeSharefileMessage = async ({
    messageId,
    threadId,
    rootPath,
    archive = true,
    extraMeta = {},
    tokensOverride = null
} = {}) => {
    const tokens = tokensOverride || getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }
    if (!messageId && threadId) {
        messageId = await resolveSharefileMessageId(threadId, tokens);
    }
    if (!messageId) {
        throw new Error('Missing messageId');
    }

    const gmail = getGmailClient(tokens);
    const labelId = await ensureLabel(gmail, PROCESSED_LABEL);

    const messageResponse = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
    });
    const message = messageResponse.data;
    const metadata = parseEmailMetadata(message);
    const noteText = buildNoteText(metadata, extraMeta);
    const attachments = collectAttachments(message.payload);
    const clientTsDate = extraMeta?.clientTs ? new Date(extraMeta.clientTs) : null;
    const routingTimestamp = clientTsDate && !Number.isNaN(clientTsDate.getTime())
        ? clientTsDate
        : new Date(Number(message?.internalDate) || Date.now());

    const resolvedRoot = rootPath || buildTargetDir({
        codeType: extraMeta.codeType,
        codeValue: extraMeta.codeValue,
        clientTs: extraMeta.clientTs
    });
    await mkdir(resolvedRoot, { recursive: true });
    const tempDir = join(tmpdir(), `sharefile-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
        const existing = getSharefileJob(messageId, extraMeta.codeType, extraMeta.codeValue);
        if (existing) {
            const existingOutput = JSON.parse(existing.output_json || '{}');
            recordSharefileRoutingEvent({
                jobId: existing.id,
                messageId,
                threadId: threadId || message.threadId || null,
                codeType: extraMeta.codeType,
                codeValue: extraMeta.codeValue,
                status: 'success',
                output: existingOutput
            });
            return { ok: true, idempotent: true, output: existingOutput };
        }

        const outputFiles = [];
        const routeKind = normalizeRouteKind(extraMeta.routeKind);
    if (attachments.length === 0) {
            const bodyText = extractGmailMessageText(message) || message.snippet || '';
            const htmlBody = extractGmailMessageHtml(message);
            let pdfBytes;
            try {
                const html = buildEmailHtml(metadata, htmlBody, bodyText);
                pdfBytes = await renderEmailHtmlToPdf(html);
            } catch (error) {
                console.warn('HTML email render failed, falling back to text PDF:', error);
                pdfBytes = await renderEmailToPdf(metadata, bodyText);
            }
            const { filename, targetPath } = await buildInvoiceFilename({
                kind: routeKind,
                timestamp: routingTimestamp,
                targetDir: resolvedRoot
            });
            const notedBytes = await addNoteToPdf(pdfBytes, noteText);
            const tempPath = join(tempDir, filename);
            await writeFile(tempPath, notedBytes);
            await moveFileSafe(tempPath, targetPath);
            outputFiles.push({ name: filename, bytes: notedBytes.length });
    } else {
            let index = 0;
            for (const attachment of attachments) {
                const attachmentResponse = await gmail.users.messages.attachments.get({
                    userId: 'me',
                    messageId,
                    id: attachment.attachmentId
                });
                const data = attachmentResponse.data?.data;
                if (!data) continue;
                const rawBytes = decodeAttachmentData(data);
                const sourcePath = join(tempDir, attachment.filename || `attachment-${index}`);
                await writeFile(sourcePath, rawBytes);
                const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                const pdfBytes = await readFile(pdfPath);
                const { filename, targetPath } = await buildInvoiceFilename({
                    kind: routeKind,
                    timestamp: routingTimestamp,
                    targetDir: resolvedRoot
                });
                const notedBytes = await addNoteToPdf(pdfBytes, noteText);
                const tempPath = join(tempDir, filename);
                await writeFile(tempPath, notedBytes);
                await moveFileSafe(tempPath, targetPath);
                outputFiles.push({ name: filename, bytes: notedBytes.length });
                index += 1;
            }
        }

        const thread = threadId || message.threadId;
        if (thread) {
            await gmail.users.threads.modify({
                userId: 'me',
                id: thread,
                requestBody: {
                    addLabelIds: [labelId],
                    removeLabelIds: archive ? ['INBOX'] : []
                }
            });
        } else {
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    addLabelIds: [labelId],
                    removeLabelIds: archive ? ['INBOX'] : []
                }
            });
        }
        const output = {
            targetDir: resolvedRoot,
            files: outputFiles
        };
        const job = saveSharefileJob({
            messageId,
            threadId: thread || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            output
        });
        recordSharefileRoutingEvent({
            jobId: job.id,
            messageId,
            threadId: thread || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'success',
            output
        });
        return { ok: true, jobId: job.id, resolved: { messageId, threadId: thread || null }, output };
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
};
