import express from 'express';
import multer from 'multer';
import { tmpdir } from 'os';
import { join, extname, basename } from 'path';
import { mkdir, copyFile, readFile, rm, writeFile, access } from 'fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { sqlite as db } from '../db.js';
import {
    readVestryPacketCache,
    writeVestryPacketCache,
    safePacketCacheId,
    removeCachedPacketFile,
    VESTRY_PACKET_CACHE_DIR,
    prepareVestryCertificate,
    renderDocxTemplate,
    convertDocxBufferToPreviewBase64,
    printDocxBuffer,
    ensurePdf
} from '../helpers/vestry-utils.js';

const router = express.Router();
const vestryUpload = multer({ dest: join(tmpdir(), 'vestry-packet-uploads') });

// --- Vestry Packet Builder ---

router.post('/packet', vestryUpload.any(), async (req, res) => {
    const files = req.files || [];
    const filesById = new Map(files.map((file) => [file.fieldname, file]));
    const convertedFiles = [];
    const convertedDirs = [];
    try {
        const order = JSON.parse(req.body?.order || '[]');
        const cached = JSON.parse(req.body?.cached || '[]');
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ error: 'Packet order is required' });
        }

        const packetDoc = await PDFDocument.create();

        const cachedMap = new Map(
            Array.isArray(cached)
                ? cached.filter((item) => item?.id && item?.cacheId).map((item) => [item.id, item.cacheId])
                : []
        );
        const cacheEntries = await readVestryPacketCache();

        for (const item of order) {
            if (!item || !item.id) continue;
            const file = filesById.get(item.id);
            let fileDescriptor = null;
            if (file) {
                fileDescriptor = {
                    filePath: file.path,
                    originalName: file.originalname || '',
                    mimetype: file.mimetype || ''
                };
            } else {
                const cacheId = cachedMap.get(item.id);
                const entry = cacheId ? cacheEntries?.[item.id] : null;
                if (entry && entry.cacheId === cacheId && entry.path) {
                    try {
                        await access(entry.path);
                        fileDescriptor = {
                            filePath: entry.path,
                            originalName: entry.originalName || basename(entry.path),
                            mimetype: ''
                        };
                    } catch {
                        fileDescriptor = null;
                    }
                }
            }
            if (!fileDescriptor) {
                if (item.required && !item.excluded) {
                    return res.status(400).json({ error: `Missing required document: ${item.label || item.id}` });
                }
                continue;
            }

            const { pdfPath, isConverted, outputDir } = await ensurePdf(fileDescriptor);
            if (isConverted) {
                convertedFiles.push(pdfPath);
                convertedDirs.push(outputDir);
            }

            const srcBytes = await readFile(pdfPath);
            const srcDoc = await PDFDocument.load(srcBytes);
            const pages = await packetDoc.copyPages(srcDoc, srcDoc.getPageIndices());
            pages.forEach((page) => packetDoc.addPage(page));
        }

        const pages = packetDoc.getPages();
        const totalPages = pages.length;
        const font = await packetDoc.embedFont(StandardFonts.Helvetica);
        pages.forEach((page, index) => {
            const label = `Page ${index + 1} of ${totalPages}`;
            const fontSize = 9;
            const { width } = page.getSize();
            const textWidth = font.widthOfTextAtSize(label, fontSize);
            const textHeight = font.heightAtSize(fontSize);
            const paddingX = 6;
            const paddingY = 3;
            const rightMargin = 18;
            const bottomMargin = 18;
            const x = width - rightMargin - paddingX - textWidth;
            const y = bottomMargin + paddingY;
            page.drawRectangle({
                x: x - paddingX,
                y: y - paddingY,
                width: textWidth + (paddingX * 2),
                height: textHeight + (paddingY * 2),
                color: rgb(1, 1, 1)
            });
            page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.35, 0.35, 0.35) });
        });

        const pdfBytes = await packetDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="vestry-packet.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Vestry packet error:', error);
        res.status(500).json({ error: error?.message || 'Failed to build vestry packet' });
    } finally {
        await Promise.all([
            ...files.map((file) => rm(file.path, { force: true }).catch(() => { })),
            ...convertedFiles.map((filePath) => rm(filePath, { force: true }).catch(() => { }))
        ]);
        await Promise.all(
            convertedDirs.map((dirPath) => rm(dirPath, { recursive: true, force: true }).catch(() => { }))
        );
    }
});

// --- Packet Cache Management ---

router.get('/packet/cache', async (req, res) => {
    try {
        const cache = await readVestryPacketCache();
        const items = Object.entries(cache || {}).map(([id, entry]) => ({
            id,
            cacheId: entry.cacheId,
            originalName: entry.originalName,
            updatedAt: entry.updatedAt || null
        }));
        res.json({ items });
    } catch (error) {
        console.error('Vestry packet cache list error:', error);
        res.status(500).json({ error: 'Failed to load cached files' });
    }
});

router.post('/packet/cache', vestryUpload.single('file'), async (req, res) => {
    const file = req.file;
    const itemId = String(req.body?.itemId || '').trim();
    if (!itemId || !file) {
        if (file?.path) {
            await rm(file.path, { force: true }).catch(() => { });
        }
        return res.status(400).json({ error: 'itemId and file are required' });
    }
    const safeId = safePacketCacheId(itemId);
    if (!safeId) {
        if (file?.path) {
            await rm(file.path, { force: true }).catch(() => { });
        }
        return res.status(400).json({ error: 'Invalid itemId' });
    }
    const cacheId = `${safeId}-${Date.now()}`;
    const originalName = file.originalname || 'document';
    const ext = extname(originalName) || extname(file.path) || '';
    const targetName = `${cacheId}${ext}`;
    const targetPath = join(VESTRY_PACKET_CACHE_DIR, targetName);
    try {
        await mkdir(VESTRY_PACKET_CACHE_DIR, { recursive: true });
        await copyFile(file.path, targetPath);
        const cache = await readVestryPacketCache();
        const existing = cache?.[itemId];
        await removeCachedPacketFile(existing);
        cache[itemId] = {
            cacheId,
            originalName,
            path: targetPath,
            updatedAt: new Date().toISOString()
        };
        await writeVestryPacketCache(cache);
        res.json({
            itemId,
            cacheId,
            originalName
        });
    } catch (error) {
        console.error('Vestry packet cache upload error:', error);
        res.status(500).json({ error: 'Failed to cache file' });
    } finally {
        if (file?.path) {
            await rm(file.path, { force: true }).catch(() => { });
        }
    }
});

router.delete('/packet/cache', async (req, res) => {
    try {
        const cache = await readVestryPacketCache();
        const entries = Object.values(cache || {});
        await Promise.all(entries.map((entry) => removeCachedPacketFile(entry)));
        await writeVestryPacketCache({});
        res.json({ success: true });
    } catch (error) {
        console.error('Vestry packet cache clear error:', error);
        res.status(500).json({ error: 'Failed to clear cached files' });
    }
});

// --- Vestry Certificates ---

router.post('/certificate', async (req, res) => {
    try {
        const { data, templateInput, outputName, outputDir } = await prepareVestryCertificate(req.body);
        await mkdir(outputDir, { recursive: true });
        const docBuffer = await renderDocxTemplate(templateInput, data);
        await writeFile(join(outputDir, outputName), docBuffer);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
        res.send(docBuffer);
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate error:', error);
        res.status(status).json({ error: error?.message || 'Failed to build certificate' });
    }
});

router.post('/certificate/preview', async (req, res) => {
    try {
        const { data, templateInput, outputName } = await prepareVestryCertificate(req.body);
        const docBuffer = await renderDocxTemplate(templateInput, data);
        const pngBase64 = await convertDocxBufferToPreviewBase64(docBuffer, outputName);
        res.json({
            filename: outputName,
            pngBase64
        });
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate preview error:', error);
        res.status(status).json({ error: error?.message || 'Failed to build certificate preview' });
    }
});

router.post('/certificate/save', async (req, res) => {
    try {
        const { data, templateInput, outputName, outputDir } = await prepareVestryCertificate(req.body);
        await mkdir(outputDir, { recursive: true });
        const docBuffer = await renderDocxTemplate(templateInput, data);
        await writeFile(join(outputDir, outputName), docBuffer);
        res.json({ filename: outputName });
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate save error:', error);
        res.status(status).json({ error: error?.message || 'Failed to save certificate' });
    }
});

router.post('/certificate/print', async (req, res) => {
    try {
        const { data, templateInput } = await prepareVestryCertificate(req.body);
        const docBuffer = await renderDocxTemplate(templateInput, data);
        await printDocxBuffer(docBuffer);
        res.json({ success: true });
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate print error:', error);
        res.status(status).json({ error: error?.message || 'Failed to print certificate' });
    }
});

// --- Vestry Checklist ---

router.get('/checklist', (req, res) => {
    const month = Number(req.query.month);
    try {
        if (!month || Number.isNaN(month)) {
            const rows = db.prepare(`
                SELECT id, month, month_name, phase, task, notes, sort_order
                FROM vestry_checklist
                ORDER BY month, sort_order, id
            `).all();
            return res.json(rows);
        }
        const rows = db.prepare(`
            SELECT id, month, month_name, phase, task, notes, sort_order
            FROM vestry_checklist
            WHERE month = ?
            ORDER BY sort_order, id
        `).all(month);
        res.json(rows);
    } catch (error) {
        console.error('Vestry checklist error:', error);
        res.status(500).json({ error: 'Failed to load vestry checklist' });
    }
});

export default router;
