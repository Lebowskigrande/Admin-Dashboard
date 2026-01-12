import xlsx from 'xlsx';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sqlite } from '../db.js';
import { runMigrations, closeDb } from './migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOMS_PATH = resolve(__dirname, '../../Rooms.xlsx');

const slugifyName = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
};

const PREFERRED_BUILDING_IDS = new Map([
    ['church', 'sanctuary'],
    ['fellows hall', 'parish-hall'],
    ['office/school', 'office'],
    ['chapel', 'chapel']
]);

const normalizeKey = (value) => String(value || '')
    .trim()
    .toLowerCase();

const getBuildingId = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const normalized = normalizeKey(trimmed);
    const preferredId = PREFERRED_BUILDING_IDS.get(normalized);
    if (preferredId) {
        const preferredRow = sqlite.prepare('SELECT id FROM buildings WHERE id = ?').get(preferredId);
        if (preferredRow?.id) return preferredRow.id;
    }
    const row = sqlite.prepare('SELECT id FROM buildings WHERE lower(name) = lower(?)').get(trimmed);
    if (row?.id) return row.id;
    const id = slugifyName(trimmed) || `building-${Date.now()}`;
    sqlite.prepare(`
        INSERT INTO buildings (
            id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        trimmed,
        'All Purpose',
        0,
        0,
        0,
        0,
        0,
        JSON.stringify([]),
        ''
    );
    return id;
};

const importRooms = () => {
    runMigrations();

    const workbook = xlsx.readFile(ROOMS_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const grouped = new Map();
    rows.forEach((row) => {
        const buildingName = String(row.Building || '').trim();
        if (!buildingName) return;
        if (!grouped.has(buildingName)) grouped.set(buildingName, []);
        grouped.get(buildingName).push(row);
    });

    const updateBuilding = sqlite.prepare(`
        UPDATE buildings
        SET capacity = ?, rental_rate_day = ?
        WHERE id = ?
    `);
    const deleteRooms = sqlite.prepare('DELETE FROM rooms WHERE building_id = ?');
    const insertRoom = sqlite.prepare(`
        INSERT INTO rooms (id, building_id, name, floor, capacity, rental_rate, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = sqlite.transaction(() => {
        PREFERRED_BUILDING_IDS.forEach((preferredId, nameKey) => {
            const duplicateRows = sqlite.prepare(`
                SELECT id FROM buildings
                WHERE lower(name) = ? AND id != ?
            `).all(nameKey, preferredId);
            duplicateRows.forEach((row) => {
                sqlite.prepare('UPDATE rooms SET building_id = ? WHERE building_id = ?').run(preferredId, row.id);
                sqlite.prepare('DELETE FROM buildings WHERE id = ?').run(row.id);
            });
        });

        grouped.forEach((entries, buildingName) => {
            const buildingId = getBuildingId(buildingName);
            if (!buildingId) return;

            const buildingRow = entries.find((entry) => !String(entry.Room || '').trim()) || {};
            const buildingCapacity = toNumber(buildingRow.Capacity) ?? 0;
            const buildingRate = toNumber(buildingRow['Rental rate']) ?? 0;
            updateBuilding.run(buildingCapacity, buildingRate, buildingId);

            deleteRooms.run(buildingId);

            entries
                .filter((entry) => String(entry.Room || '').trim())
                .forEach((entry) => {
                    const roomName = String(entry.Room || '').trim();
                    const floorValue = entry.Floor === '' || entry.Floor === null
                        ? null
                        : Number.parseInt(entry.Floor, 10);
                    const floor = Number.isNaN(floorValue) ? null : floorValue;
                    const capacity = toNumber(entry.Capacity);
                    const rentalRate = toNumber(entry['Rental rate']);
                    const roomId = `room-${buildingId}-${slugifyName(roomName)}`;
                    insertRoom.run(
                        roomId,
                        buildingId,
                        roomName,
                        floor,
                        capacity,
                        rentalRate,
                        ''
                    );
                });
        });
    });

    transaction();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        importRooms();
        console.log('Rooms import complete.');
    } finally {
        closeDb();
    }
}
