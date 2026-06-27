import express from 'express';
import { sqlite as db } from '../db.js';
import { parseNotes, tableExists, tableHasColumn } from '../helpers/db-utils.js';
import { findBulletinFile, findInsertFile } from '../helpers/file-utils.js';
import {
    getBulletinStatus,
    upsertBulletinStatus,
    buildDocumentStatus
} from '../services/bulletinService.js';
import {
    TEN_AM_ROLE_KEYS,
    EIGHT_AM_ROLE_KEYS,
    EIGHT_AM_LECTOR_ROLE_KEY,
    ROLE_KEYS,
    DEFAULT_LOCATION_BY_TIME,
    applyRotationForDate,
    ensureSundayOccurrence,
    replaceAssignmentsForServiceRole,
    syncLinkedSundayAliasOccurrences,
    isSundayDate,
    buildUpcomingSundaySchedule,
    buildScheduleForMonths,
    getReadingPair,
    loadSundayOccurrences
} from '../helpers/sunday-utils.js';
import { uploadBulletinToDropbox } from '../services/bulletinUploadService.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import xlsx from 'xlsx';
import { format } from 'date-fns';

const router = express.Router();

const parseDateKeyLocal = (dateKey) => {
    const value = String(dateKey || '').trim();
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return new Date(value);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const getServiceRoleKeys = (time = '') => (
    String(time || '').startsWith('08')
        ? EIGHT_AM_ROLE_KEYS
        : TEN_AM_ROLE_KEYS
);

router.get('/sunday/livestream', (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'date is required' });
    }
    const occurrence = db.prepare(`
        SELECT notes FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = '10:00'
        LIMIT 1
    `).get(date);
    const notes = parseNotes(occurrence?.notes);
    res.json({
        url: notes.youtubeUrl || '',
        title: notes.youtubeTitle || '',
        videoId: notes.youtubeVideoId || '',
        scheduledStart: notes.youtubeScheduledStart || ''
    });
});

router.get('/sunday/documents', async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'date is required' });
    }
    try {
        const includePreview = String(req.query.preview || '').trim() !== '0';
        const forcePreview = String(req.query.forcePreview || '').trim() === '1';
        const doc = String(req.query.doc || '').trim();
        const bulletin10Path = await findBulletinFile(date, '10am');
        const bulletin8Path = await findBulletinFile(date, '8am');
        const insertPath = await findInsertFile(date);

        const bulletin10Stored = getBulletinStatus(date, 'bulletin10');
        const bulletin8Stored = getBulletinStatus(date, 'bulletin8');
        const insertStored = getBulletinStatus(date, 'insert');

        const wantsBulletin10 = !doc || doc === 'bulletin10';
        const wantsBulletin8 = !doc || doc === 'bulletin8';
        const wantsInsert = !doc || doc === 'insert';

        const bulletin10Status = bulletin10Stored;
        const bulletin8Status = bulletin8Stored;

        let bulletin10 = null;
        let bulletin8 = null;
        let insert = null;

        const [bulletin10Result, bulletin8Result, insertResult] = await Promise.all([
            wantsBulletin10
                ? buildDocumentStatus(bulletin10Path, {
                    includePreview,
                    statusOverride: bulletin10Status,
                    forcePreview
                })
                : Promise.resolve(null),
            wantsBulletin8
                ? buildDocumentStatus(bulletin8Path, {
                    includePreview,
                    statusOverride: bulletin8Status,
                    forcePreview
                })
                : Promise.resolve(null),
            wantsInsert
                ? buildDocumentStatus(insertPath, {
                    includePreview,
                    statusOverride: insertStored,
                    forcePreview
                })
                : Promise.resolve(null)
        ]);

        bulletin10 = bulletin10Result;
        bulletin8 = bulletin8Result;
        insert = insertResult;

        if (bulletin10?.exists && bulletin10Status) bulletin10.status = bulletin10Status;
        if (bulletin8?.exists && bulletin8Status) bulletin8.status = bulletin8Status;
        if (insert?.exists && insertStored) insert.status = insertStored;

        res.json({ bulletin10, bulletin8, insert });
    } catch (error) {
        console.error('Error checking documents:', error);
        res.status(500).json({ error: 'Failed to check documents' });
    }
});

router.post('/sunday/insert-status', async (req, res) => {
    const { date, status } = req.body || {};
    if (!date || !status) {
        return res.status(400).json({ error: 'date and status are required' });
    }
    try {
        upsertBulletinStatus(date, 'insert', status, 'manual');
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating insert status:', error);
        res.status(500).json({ error: 'Failed to update insert status' });
    }
});

router.get('/sunday/sundays', (req, res) => {
    const months = Number(req.query.months) || 3;
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + months, 0);

    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    const liturgicalDays = tableExists('liturgical_days')
        ? db.prepare(`
            SELECT date, feast, color, readings
            FROM liturgical_days
            WHERE date BETWEEN ? AND ?
            ORDER BY date
        `).all(startStr, endStr)
        : [];
    const liturgicalByDate = new Map(liturgicalDays.map((day) => [day.date, day]));

    const occurrencesByDate = loadSundayOccurrences(startStr, endStr);
    const dates = Array.from(new Set([
        ...liturgicalDays.map((day) => day.date),
        ...Object.keys(occurrencesByDate)
    ]))
        .filter((date) => isSundayDate(date))
        .sort((a, b) => a.localeCompare(b));

    const sundays = dates.map((date) => {
        const liturgical = liturgicalByDate.get(date) || {};
        const services = (occurrencesByDate[date] || [])
            .filter((occurrence) => ['08:00', '10:00'].includes(occurrence.start_time || '10:00'))
            .map((occurrence) => {
                const time = occurrence.start_time || '10:00';
                const rite = occurrence.rite || (time.startsWith('08') ? 'Rite I' : 'Rite II');
                const roles = ROLE_KEYS.reduce((acc, roleKey) => {
                    acc[roleKey] = occurrence.roles?.[roleKey] || [];
                    return acc;
                }, {});
                return {
                    time,
                    rite,
                    location: occurrence.building_id || DEFAULT_LOCATION_BY_TIME[time] || '',
                    notes: parseNotes(occurrence.notes),
                    roles
                };
            })
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        return {
            date,
            feast: liturgical.feast || 'Sunday',
            color: liturgical.color || 'Green',
            readings: liturgical.readings || '',
            bulletin_status: liturgical.bulletin_status || 'draft',
            services
        };
    });

    res.json(sundays);
});

router.get('/sunday/schedule-roles', (req, res) => {
    if (!tableExists('schedule_roles')) {
        return res.status(500).json({ error: 'schedule_roles table missing' });
    }
    const { date } = req.query;
    try {
        if (date) {
            const rows = db.prepare(`
                SELECT * FROM schedule_roles
                WHERE date = ?
                ORDER BY service_time ASC
            `).all(date);
            return res.json(rows);
        }
        const rows = db.prepare(`
            SELECT * FROM schedule_roles
            ORDER BY date ASC, service_time ASC
        `).all();
        return res.json(rows);
    } catch (error) {
        console.error('Error fetching schedule roles:', error);
        return res.status(500).json({ error: 'Failed to load schedule roles' });
    }
});

router.post('/bulletins/upload', async (req, res) => {
    try {
        const result = await uploadBulletinToDropbox(req.body?.path || '');
        return res.json(result);
    } catch (error) {
        console.error('Bulletin upload error:', error);
        const statusCode = Number(error?.statusCode || 500);
        return res.status(statusCode).json({ error: error?.message || 'Failed to upload bulletin' });
    }
});

router.put('/schedule-roles', (req, res) => {
    const payload = req.body || {};
    const date = payload.date;
    const serviceTime = payload.service_time || '10:00';
    if (!date) {
        return res.status(400).json({ error: 'date is required' });
    }
    if (!tableExists('schedule_roles')) {
        return res.status(500).json({ error: 'schedule_roles table missing' });
    }

    const fieldMap = {
        celebrant: 'celebrant',
        preacher: 'preacher',
        lector: 'lector',
        organist: 'organist',
        lem: 'chalice_bearer',
        acolyte: 'acolyte',
        usher: 'usher',
        sound: 'sound_engineer',
        coffeeHour: 'coffee_hour',
        childcare: 'childcare',
        location: 'location',
        chalice_bearer: 'chalice_bearer',
        sound_engineer: 'sound_engineer',
        coffee_hour: 'coffee_hour'
    };

    const updates = {};
    Object.entries(fieldMap).forEach(([apiKey, column]) => {
        if (!(apiKey in payload)) return;
        if (!tableHasColumn('schedule_roles', column)) return;
        updates[column] = payload[apiKey] ?? '';
    });

    try {
        const existing = db.prepare(`
            SELECT 1 FROM schedule_roles
            WHERE date = ? AND service_time = ?
            LIMIT 1
        `).get(date, serviceTime);

        if (existing) {
            const columns = Object.keys(updates);
            if (columns.length > 0) {
                const setClause = columns.map((col) => `${col} = ?`).join(', ');
                const values = columns.map((col) => updates[col]);
                db.prepare(`
                    UPDATE schedule_roles
                    SET ${setClause}
                    WHERE date = ? AND service_time = ?
                `).run(...values, date, serviceTime);
            }
        } else {
            const columns = ['date', 'service_time', ...Object.keys(updates)];
            const placeholders = columns.map(() => '?').join(', ');
            const values = [date, serviceTime, ...Object.keys(updates).map((key) => updates[key])];
            db.prepare(`
                INSERT INTO schedule_roles (${columns.join(', ')})
                VALUES (${placeholders})
            `).run(...values);
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Error updating schedule roles:', error);
        return res.status(500).json({ error: 'Failed to update schedule roles' });
    }
});

router.post('/sunday/schedule-roles/auto-next-month', (req, res) => {
    const { year, month } = req.body || {};
    if (!year || month === undefined) {
        return res.status(400).json({ error: 'year and month are required' });
    }

    try {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
            if (d.getDay() === 0) {
                const dateStr = d.toISOString().slice(0, 10);
                applyRotationForDate(dateStr);
            }
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error auto-generating roles:', error);
        res.status(500).json({ error: 'Failed to auto-generate roles' });
    }
});

router.post('/sunday/schedule-roles/auto-week', (req, res) => {
    const { date } = req.body || {};
    if (!date) {
        return res.status(400).json({ error: 'date is required' });
    }
    try {
        applyRotationForDate(date);
        res.json({ success: true });
    } catch (error) {
        console.error('Error auto-generating roles for week:', error);
        res.status(500).json({ error: 'Failed to auto-generate roles' });
    }
});

router.get('/sunday/roles/:date', (req, res) => {
    const { date } = req.params;
    const occurrences = db.prepare(`
        SELECT id, start_time FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ?
    `).all(date);

    const result = {};
    occurrences.forEach((occ) => {
        const assignments = db.prepare(`
            SELECT role_key, person_id FROM assignments
            WHERE occurrence_id = ?
        `).all(occ.id);

        result[occ.start_time] = {};
        assignments.forEach((asgn) => {
            const roleKey = occ.start_time === '08:00' && asgn.role_key === 'lector'
                ? EIGHT_AM_LECTOR_ROLE_KEY
                : asgn.role_key;
            if (!result[occ.start_time][roleKey]) {
                result[occ.start_time][roleKey] = [];
            }
            result[occ.start_time][roleKey].push(asgn.person_id);
        });
    });

    res.json(result);
});

router.put('/sunday/roles/:date', (req, res) => {
    const { date } = req.params;
    const payload = req.body || {};
    try {
        const occurrences = db.prepare(`
            SELECT id, start_time FROM event_occurrences
            WHERE event_id = 'sunday-service' AND date = ?
        `).all(date);

        const occMap = new Map(occurrences.map((o) => [o.start_time, o.id]));

        db.transaction(() => {
            Object.entries(payload).forEach(([time, roles]) => {
                const occId = occMap.get(time) || ensureSundayOccurrence(date, time);
                if (!occId) return;
                const validRoleKeys = new Set(getServiceRoleKeys(time));

                const location = roles?.location || roles?.building_id;
                if (location) {
                    db.prepare(`
                        UPDATE event_occurrences
                        SET building_id = ?
                        WHERE id = ?
                    `).run(location, occId);
                }

                Object.entries(roles || {}).forEach(([roleKey, personIds]) => {
                    if (roleKey === 'location' || roleKey === 'building_id' || roleKey === 'rite') return;
                    if (!ROLE_KEYS.includes(roleKey) || !validRoleKeys.has(roleKey)) return;
                    replaceAssignmentsForServiceRole(occId, time, roleKey, personIds);
                });

                const normalizedRoles = Object.entries(roles || {}).reduce((acc, [roleKey, personIds]) => {
                    if (roleKey === 'location' || roleKey === 'building_id' || roleKey === 'rite') return acc;
                    if (!ROLE_KEYS.includes(roleKey) || !validRoleKeys.has(roleKey)) return acc;
                    acc[roleKey] = Array.isArray(personIds) ? personIds : (personIds ? [personIds] : []);
                    return acc;
                }, {});

                syncLinkedSundayAliasOccurrences({
                    date,
                    startTime: time,
                    buildingId: location || null,
                    roles: normalizedRoles
                });
            });
        })();

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating roles for date:', error);
        res.status(500).json({ error: 'Failed to update roles' });
    }
});

router.get('/sunday/liturgical-days', (req, res) => {
    const { start, end } = req.query;
    let sql = 'SELECT * FROM liturgical_days';
    const params = [];

    if (start && end) {
        sql += ' WHERE date BETWEEN ? AND ?';
        params.push(start, end);
    } else if (start) {
        sql += ' WHERE date >= ?';
        params.push(start);
    } else if (end) {
        sql += ' WHERE date <= ?';
        params.push(end);
    }

    sql += ' ORDER BY date';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
});

router.post('/liturgical-schedule/pdf', async (req, res) => {
    try {
        const { date } = req.get('X-Liturgical-Date') ? { date: req.get('X-Liturgical-Date') } : req.body || {};
        const startDate = date || format(new Date(), 'yyyy-MM-dd');
        const months = buildUpcomingSundaySchedule(startDate);

        const doc = await PDFDocument.create();
        const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const pageMargin = 50;
        const bodySize = 10;
        const lineHeight = 14;

        const drawHeader = (page, monthLabel, continued = false) => {
            const { height } = page.getSize();
            const title = `St. Edmund's Liturgical Schedule — ${monthLabel}${continued ? ' (cont.)' : ''}`;
            page.drawText(title, {
                x: pageMargin,
                y: height - pageMargin,
                size: 14,
                font: fontBold,
                color: rgb(0.1, 0.1, 0.1)
            });
            return height - pageMargin - 30;
        };

        const ROLE_KEYS = [...new Set([...EIGHT_AM_ROLE_KEYS, ...TEN_AM_ROLE_KEYS])];
        const ROLE_LABELS = {
            celebrant: 'Celebrant',
            preacher: 'Preacher',
            organist: 'Organist',
            lector8: '8am Lector',
            lector: 'Lector',
            usher: 'Usher',
            acolyte: 'Acolyte',
            lem: 'LEM',
            sound: 'Sound',
            coffeeHour: 'Coffee Hour',
            childcare: 'Childcare'
        };

        const wrapTextLines = (text, font, size, maxWidth) => {
            const words = String(text || '').split(' ');
            const lines = [];
            let currentLine = '';
            words.forEach(word => {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                if (font.widthOfTextAtSize(testLine, size) <= maxWidth) {
                    currentLine = testLine;
                } else {
                    if (currentLine) lines.push(currentLine);
                    currentLine = word;
                }
            });
            if (currentLine) lines.push(currentLine);
            return lines;
        };

        months.forEach(({ month, items }) => {
            let page = doc.addPage();
            const { width, _height } = page.getSize();
            let cursorY = drawHeader(page, month);
            const maxTextWidth = width - pageMargin * 2;

            items.forEach((entry) => {
                const dateLabel = `${format(parseDateKeyLocal(entry.date), 'MMM d, yyyy')} — ${entry.feast || 'Sunday'}`;
                cursorY -= lineHeight * 1.5;
                if (cursorY < pageMargin + 40) {
                    page = doc.addPage();
                    cursorY = drawHeader(page, month, true);
                }
                page.drawText(dateLabel, {
                    x: pageMargin,
                    y: cursorY,
                    size: bodySize,
                    font: fontBold
                });

                entry.services.forEach((service) => {
                    const serviceLabel = `${service.time}${service.location ? ` (${service.location})` : ''} - ${service.rite}`;
                    cursorY -= lineHeight;
                    page.drawText(serviceLabel, {
                        x: pageMargin + 10,
                        y: cursorY,
                        size: bodySize,
                        font: fontRegular,
                        color: rgb(0.3, 0.3, 0.3)
                    });

                    ROLE_KEYS.forEach((roleKey) => {
                        const names = service.roles[roleKey];
                        if (!names) return;
                        const label = ROLE_LABELS[roleKey] || roleKey;
                        const line = `${label}: ${names}`;
                        const lines = wrapTextLines(line, fontRegular, bodySize, maxTextWidth - 20);
                        lines.forEach(l => {
                            cursorY -= lineHeight;
                            if (cursorY < pageMargin + 20) {
                                page = doc.addPage();
                                cursorY = drawHeader(page, month, true);
                            }
                            page.drawText(l, {
                                x: pageMargin + 20,
                                y: cursorY,
                                size: bodySize,
                                font: fontRegular
                            });
                        });
                    });
                });
            });
        });

        const pdfBytes = await doc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="liturgical-schedule.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('PDF error:', error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

router.post('/liturgical-schedule/pdf-months', async (req, res) => {
    try {
        const months = Array.isArray(req.body?.months) ? req.body.months : [];
        const scheduleGroups = buildScheduleForMonths(months);
        if (scheduleGroups.length === 0) {
            return res.status(400).json({ error: 'No schedule data for selected months' });
        }

        const doc = await PDFDocument.create();
        const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const pageMargin = 36;
        const headingSize = 14;
        const subheadingSize = 12;
        const bodySize = 9;
        const lineHeight = 11;
        const tableWidth = 720;
        const columns = [
            { key: 'service', label: '', width: 220 },
            { key: 'lector', label: 'Lector', width: 90 },
            { key: 'lem', label: 'LEM', width: 80 },
            { key: 'acolyte', label: 'Acolytes', width: 90 },
            { key: 'usher', label: 'Ushers', width: 90 },
            { key: 'sound', label: 'Sound/Stream', width: 80 },
            { key: 'reading', label: '', width: 70 }
        ];

        const wrapCellLines = (text, font, size, maxWidth) => {
            const segments = String(text || '').split('\n').filter(Boolean);
            const lines = [];
            segments.forEach(s => {
                const words = s.trim().split(' ');
                let cur = '';
                words.forEach(w => {
                    const test = cur ? `${cur} ${w}` : w;
                    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
                        cur = test;
                    } else {
                        if (cur) lines.push(cur);
                        cur = w;
                    }
                });
                if (cur) lines.push(cur);
            });
            return lines.length ? lines : [''];
        };

        const drawPageHeader = (page, monthLabel, continued = false) => {
            const { width, height } = page.getSize();
            const title = "St. Edmund's Episcopal Church - Liturgical Schedule";
            const titleWidth = fontBold.widthOfTextAtSize(title, headingSize);
            page.drawText(title, {
                x: (width - titleWidth) / 2,
                y: height - pageMargin - headingSize,
                size: headingSize,
                font: fontBold,
                color: rgb(0.1, 0.1, 0.1)
            });
            const monthText = continued ? `${monthLabel} (continued)` : monthLabel;
            const monthWidth = fontRegular.widthOfTextAtSize(monthText, subheadingSize);
            page.drawText(monthText, {
                x: (width - monthWidth) / 2,
                y: height - pageMargin - headingSize - 16,
                size: subheadingSize,
                font: fontRegular,
                color: rgb(0.2, 0.2, 0.2)
            });
            return height - pageMargin - headingSize - 34;
        };

        const drawTableHeader = (page, topY, monthLabel) => {
            const { width } = page.getSize();
            const left = (width - tableWidth) / 2;
            const headerHeight = lineHeight + 8;
            page.drawRectangle({
                x: left,
                y: topY - headerHeight,
                width: tableWidth,
                height: headerHeight,
                color: rgb(0.86, 0.86, 0.86),
                borderWidth: 1,
                borderColor: rgb(0.1, 0.1, 0.1)
            });
            let cursorX = left;
            columns.forEach((col, index) => {
                const label = index === 0 ? monthLabel.toUpperCase() : col.label;
                if (label) {
                    const textWidth = fontBold.widthOfTextAtSize(label, bodySize);
                    page.drawText(label, {
                        x: cursorX + (col.width - textWidth) / 2,
                        y: topY - headerHeight + 4,
                        size: bodySize,
                        font: fontBold,
                        color: rgb(0.1, 0.1, 0.1)
                    });
                }
                cursorX += col.width;
            });
            return topY - headerHeight;
        };

        const drawRow = (page, topY, cells, rowIndex) => {
            const { width } = page.getSize();
            const left = (width - tableWidth) / 2;
            const lineSets = columns.map(col => wrapCellLines(cells[col.key] || '', fontRegular, bodySize, col.width - 8));
            const rowHeight = Math.max(...lineSets.map(ls => ls.length)) * lineHeight + 6;
            let cursorX = left;
            const stripeFill = Math.floor(rowIndex / 2) % 2 === 0 ? rgb(0.92, 0.92, 0.92) : null;
            lineSets.forEach((lines, index) => {
                page.drawRectangle({
                    x: cursorX,
                    y: topY - rowHeight,
                    width: columns[index].width,
                    height: rowHeight,
                    color: stripeFill || undefined,
                    borderWidth: 1,
                    borderColor: rgb(0.1, 0.1, 0.1)
                });
                lines.forEach((line, lineIndex) => {
                    page.drawText(line, {
                        x: cursorX + 4,
                        y: topY - 10.5 - lineIndex * lineHeight,
                        size: bodySize,
                        font: fontRegular
                    });
                });
                cursorX += columns[index].width;
            });
            return rowHeight;
        };

        scheduleGroups.forEach(({ monthLabel, rows }) => {
            let page = doc.addPage([792, 612]);
            let cursorY = drawPageHeader(page, monthLabel);
            cursorY = drawTableHeader(page, cursorY, monthLabel);

            rows.forEach((row, index) => {
                const timeLabel = String(row.time || '').replace(/^0/, '').replace(':00', ':00 AM');
                const serviceLines = [
                    `Sunday, ${format(parseDateKeyLocal(row.date), 'MMMM d')}`,
                    timeLabel,
                    row.location ? `${row.feast} (${row.location})` : row.feast
                ].filter(Boolean);

                const cells = {
                    service: serviceLines.join('\n'),
                    lector: row.lector,
                    lem: row.lem,
                    acolyte: row.acolyte,
                    usher: row.usher,
                    sound: row.sound,
                    reading: row.reading
                };

                const rowHeight = Math.max(...columns.map(col => wrapCellLines(cells[col.key], fontRegular, bodySize, col.width - 8).length)) * lineHeight + 6;
                if (cursorY - rowHeight < pageMargin + 28) {
                    page = doc.addPage([792, 612]);
                    cursorY = drawPageHeader(page, monthLabel, true);
                    cursorY = drawTableHeader(page, cursorY, monthLabel);
                }
                const usedHeight = drawRow(page, cursorY, cells, index);
                cursorY -= usedHeight;
            });
        });

        const pdfBytes = await doc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="liturgical-schedule-table.pdf"`);
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Liturgical schedule months PDF error:', error);
        res.status(500).json({ error: 'Failed to build liturgical schedule PDF' });
    }
});

router.post('/liturgical-schedule/xlsx-months', async (req, res) => {
    try {
        const months = Array.isArray(req.body?.months) ? req.body.months : [];
        const scheduleGroups = buildScheduleForMonths(months);
        if (scheduleGroups.length === 0) {
            return res.status(400).json({ error: 'No schedule data for selected months' });
        }

        const dateSet = new Set();
        scheduleGroups.forEach(group => group.rows.forEach(row => dateSet.add(row.date)));
        const dates = Array.from(dateSet);
        const readingsMap = new Map();
        if (dates.length > 0) {
            const placeholders = dates.map(() => '?').join(',');
            const rows = db.prepare(`SELECT date, readings FROM liturgical_days WHERE date IN (${placeholders})`).all(...dates);
            rows.forEach(row => readingsMap.set(row.date, row.readings));
        }

        const sheetRows = [];
        scheduleGroups.forEach(group => {
            group.rows.forEach(row => {
                const readings = readingsMap.get(row.date) || '';
                const { oldTestament, newTestament } = getReadingPair(readings);
                sheetRows.push({
                    Month: group.monthLabel,
                    Date: format(parseDateKeyLocal(row.date), 'yyyy-MM-dd'),
                    Service: row.time || '10:00',
                    Feast: row.location ? `${row.feast} (${row.location})` : row.feast,
                    Lector: row.lector || '',
                    LEM: row.lem || '',
                    Acolytes: row.acolyte || '',
                    Ushers: row.usher || '',
                    'Sound/Stream': row.sound || '',
                    'Old Testament': oldTestament || '',
                    'New Testament': newTestament || ''
                });
            });
        });

        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(sheetRows);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Liturgical Schedule');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="liturgical-schedule.xlsx"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('Liturgical schedule XLSX error:', error);
        res.status(500).json({ error: 'Failed to build liturgical schedule spreadsheet' });
    }
});

export default router;
