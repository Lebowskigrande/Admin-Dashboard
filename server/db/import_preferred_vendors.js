import xlsx from 'xlsx';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sqlite } from '../db.js';
import { runMigrations, closeDb } from './migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VENDORS_PATH = resolve(__dirname, '../../Preferred Vendors.xlsx');

const slugify = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const clean = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value).trim();
    return String(value).trim();
};

const importPreferredVendors = () => {
    runMigrations();
    const workbook = xlsx.readFile(VENDORS_PATH);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const deleteAll = sqlite.prepare('DELETE FROM preferred_vendors');
    const insert = sqlite.prepare(`
        INSERT INTO preferred_vendors (id, service, vendor, contact, phone, email, notes, contract)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = sqlite.transaction(() => {
        deleteAll.run();
        rows.forEach((row, index) => {
            const vendorName = clean(row.Vendor || row['Vendor']);
            if (!vendorName) return;
            const service = clean(row.Service || row['Service']);
            const contact = clean(row.Contact || row['Contact']);
            const phone = clean(row.Phone || row['Phone']);
            const email = clean(row.Email || row['Email']);
            const notes = clean(row.Notes || row['Notes']);
            const contract = clean(row.Contract || row['Contract']);
            const baseId = slugify(`${vendorName}-${service}`) || `vendor-${index + 1}`;
            const id = `vendor-${baseId}`;
            insert.run(id, service, vendorName, contact, phone, email, notes, contract);
        });
    });

    transaction();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        importPreferredVendors();
        console.log('Preferred vendors import complete.');
    } finally {
        closeDb();
    }
}
