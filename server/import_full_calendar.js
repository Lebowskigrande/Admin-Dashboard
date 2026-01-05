import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const excelPath = join(__dirname, '../episcopal_liturgical_2026_database.xlsx');

console.log('Reading Excel file:', excelPath);

const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON objects
const data = XLSX.utils.sheet_to_json(worksheet);

console.log(`Found ${data.length} rows in Excel file`);

// Extract readings from description_raw
const extractReadings = (rawDescription) => {
    if (!rawDescription) return '';

    // The description contains readings after the color line
    // Example: "Year A / II\nChristmas\nWhite\nPsalm 8\nNumbers 6:22-27\n..."
    const lines = rawDescription.split('\n').filter(l => l.trim());

    // Skip first 3 lines (Year, Season, Color), rest are readings
    const readings = lines.slice(3).join('; ');
    return readings || '';
};

// Filter for TEC (The Episcopal Church) entries only
const tecEntries = data.filter(row => row.categories === 'TEC');

console.log(`Found ${tecEntries.length} TEC liturgical days in 2026`);

// Clear existing data
db.prepare('DELETE FROM liturgical_days').run();
console.log('Cleared existing liturgical data');

// Insert all TEC entries (use OR REPLACE to handle duplicates)
const insert = db.prepare(`
    INSERT OR REPLACE INTO liturgical_days (date, feast, color, readings)
    VALUES (?, ?, ?, ?)
`);

const insertMany = db.transaction((entries) => {
    for (const entry of entries) {
        const readings = extractReadings(entry.description_raw);
        insert.run(entry.date, entry.summary, entry.color, readings);
    }
});

insertMany(tecEntries);

console.log(`Successfully imported ${tecEntries.length} liturgical days into database`);

// Show sample
const sample = db.prepare('SELECT * FROM liturgical_days ORDER BY date LIMIT 5').all();
console.log('\nSample entries:');
sample.forEach(s => console.log(`  ${s.date}: ${s.feast} (${s.color})`));

const count = db.prepare('SELECT COUNT(*) as count FROM liturgical_days').get();
console.log(`\nTotal liturgical days in database: ${count.count}`);

// Show Sundays count
const sundaysCount = db.prepare(`
    SELECT COUNT(*) as count FROM liturgical_days 
    WHERE CAST(strftime('%w', date) AS INTEGER) = 0
`).get();
console.log(`Sundays in database: ${sundaysCount.count}`);
