import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_SOURCE = join(__dirname, '..', '..', 'PCEXPORTDATA.xlsx');
const sourcePath = process.argv[2] || DEFAULT_SOURCE;

const normalizeName = (value = '') => value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeDisplayName = (value = '') => toValue(value).replace(/\s+/g, ' ').trim();

const buildDisplayName = (firstName, lastName) => {
    const first = normalizeDisplayName(firstName);
    const last = normalizeDisplayName(lastName);
    return normalizeDisplayName(`${first} ${last}`);
};

const slugifyName = (value = '') => normalizeDisplayName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toValue = (value) => (value || '').toString().trim();

const splitHouseholdNames = (value = '') => {
    const cleaned = value
        .replace(/\s*&\s*/g, ' and ')
        .replace(/\s+and\s+/gi, ' and ');
    return cleaned
        .split(/\s+and\s+|\/|,|;/i)
        .map((part) => part.trim())
        .filter(Boolean);
};

const workbook = xlsx.read(readFileSync(sourcePath), { type: 'buffer' });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
const sampleKeys = rows.length ? Object.keys(rows[0]) : [];
const isPowerChurchExport = sampleKeys.includes('firstname_b') || sampleKeys.includes('lastname_b');

const db = new Database(join(__dirname, '..', 'church.db'));
const hasTable = (name) => !!db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
`).get(name);

const usePerson = hasTable('person');
const usePeople = !usePerson && hasTable('people');

if (!usePerson && !usePeople) {
    throw new Error('No person/people table found in church.db');
}

if (usePeople) {
    const columns = db.prepare('PRAGMA table_info(people)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    const addColumn = (name) => {
        if (!columnSet.has(name)) {
            db.exec(`ALTER TABLE people ADD COLUMN ${name} TEXT`);
            columnSet.add(name);
        }
    };
    addColumn('phone_primary');
    addColumn('phone_alternate');
    addColumn('address_line1');
    addColumn('address_line2');
    addColumn('city');
    addColumn('state');
    addColumn('postal_code');
}

const peopleRows = usePerson
    ? db.prepare('SELECT * FROM person').all()
    : db.prepare('SELECT * FROM people').all();
const peopleByName = new Map();
const peopleByLastName = new Map();

peopleRows.forEach((row) => {
    if (!row.display_name) return;
    const normalized = normalizeName(row.display_name);
    if (normalized) peopleByName.set(normalized, row);
    const lastToken = normalized.split(' ').slice(-1)[0];
    if (!lastToken) return;
    if (!peopleByLastName.has(lastToken)) {
        peopleByLastName.set(lastToken, []);
    }
    peopleByLastName.get(lastToken).push(row);
});

let matched = 0;
let updated = 0;
let skipped = 0;

const updateStmt = usePerson
    ? db.prepare(`
        UPDATE person SET
            email_primary = ?,
            phone_primary = ?,
            phone_secondary = ?,
            address1 = ?,
            address2 = ?,
            city = ?,
            state = ?,
            zip = ?,
            updated_at = datetime('now')
        WHERE person_id = ?
    `)
    : db.prepare(`
        UPDATE people SET
            email = ?,
            phone_primary = ?,
            phone_alternate = ?,
            address_line1 = ?,
            address_line2 = ?,
            city = ?,
            state = ?,
            postal_code = ?
        WHERE id = ?
    `);

const insertPeopleStmt = usePeople
    ? db.prepare(`
        INSERT INTO people (
            id, display_name, email, category, roles, tags, teams,
            phone_primary, phone_alternate, address_line1, address_line2, city, state, postal_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    : null;

const ensureUniquePeopleId = (baseId) => {
    let candidate = baseId || `person-${Date.now()}`;
    let counter = 2;
    while (db.prepare('SELECT 1 FROM people WHERE id = ?').get(candidate)) {
        candidate = `${baseId}-${counter}`;
        counter += 1;
    }
    return candidate;
};

rows.forEach((row) => {
    const rawName = toValue(row.first_last || '');
    const rawLastName = toValue(row.lastname || '');
    const rawFirstName = toValue(row.firstname_b || row.first_name || '');
    const rawLastNameAlt = toValue(row.lastname_b || row.last_name || '');
    const displayName = isPowerChurchExport
        ? buildDisplayName(rawFirstName, rawLastNameAlt)
        : normalizeDisplayName(rawName);
    const normalizedName = normalizeName(displayName || rawName);
    const normalizedLast = normalizeName(rawLastName || rawLastNameAlt);
    if (!normalizedName && !normalizedLast) {
        skipped += 1;
        return;
    }
    let person = normalizedName ? peopleByName.get(normalizedName) : null;
    if (!person && (rawName || displayName)) {
        const parts = splitHouseholdNames(displayName || rawName);
        for (const part of parts) {
            const normalizedPart = normalizeName(part);
            if (normalizedPart && peopleByName.has(normalizedPart)) {
                person = peopleByName.get(normalizedPart);
                break;
            }
        }
    }
    if (!person && normalizedLast && peopleByLastName.has(normalizedLast)) {
        const candidates = peopleByLastName.get(normalizedLast);
        if (candidates.length === 1) {
            person = candidates[0];
        }
    }

    const incoming = {
        displayName,
        email: toValue(row.e_mail_a || row.e_mail_b),
        phonePrimary: toValue(row.phone1),
        phoneSecondary: toValue(row.phone2),
        address1: toValue(row.address),
        address2: toValue(row.address2),
        city: toValue(row.city),
        state: toValue(row.state),
        zip: toValue(row.zip),
        envNo: toValue(row.env_no)
    };

    if (!person && usePeople && incoming.displayName) {
        const baseId = slugifyName(incoming.displayName);
        const id = ensureUniquePeopleId(baseId);
        insertPeopleStmt.run(
            id,
            incoming.displayName,
            incoming.email || '',
            'parishioner',
            JSON.stringify([]),
            JSON.stringify(incoming.envNo ? [`env-${incoming.envNo}`] : []),
            JSON.stringify({}),
            incoming.phonePrimary || '',
            incoming.phoneSecondary || '',
            incoming.address1 || '',
            incoming.address2 || '',
            incoming.city || '',
            incoming.state || '',
            incoming.zip || ''
        );
        const inserted = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
        if (inserted) {
            person = inserted;
        }
    }

    if (!person) {
        skipped += 1;
        return;
    }
    matched += 1;

    const next = usePerson
        ? {
            email: person.email_primary || incoming.email || '',
            phonePrimary: person.phone_primary || incoming.phonePrimary || '',
            phoneSecondary: person.phone_secondary || incoming.phoneSecondary || '',
            address1: person.address1 || incoming.address1 || '',
            address2: person.address2 || incoming.address2 || '',
            city: person.city || incoming.city || '',
            state: person.state || incoming.state || '',
            zip: person.zip || incoming.zip || ''
        }
        : {
            email: person.email || incoming.email || '',
            phonePrimary: person.phone_primary || incoming.phonePrimary || '',
            phoneSecondary: person.phone_alternate || incoming.phoneSecondary || '',
            address1: person.address_line1 || incoming.address1 || '',
            address2: person.address_line2 || incoming.address2 || '',
            city: person.city || incoming.city || '',
            state: person.state || incoming.state || '',
            zip: person.postal_code || incoming.zip || ''
        };

    const changed = usePerson
        ? Object.entries({
            email_primary: next.email,
            phone_primary: next.phonePrimary,
            phone_secondary: next.phoneSecondary,
            address1: next.address1,
            address2: next.address2,
            city: next.city,
            state: next.state,
            zip: next.zip
        }).some(([key, value]) => (person[key] || '') !== (value || ''))
        : Object.entries({
            email: next.email,
            phone_primary: next.phonePrimary,
            phone_alternate: next.phoneSecondary,
            address_line1: next.address1,
            address_line2: next.address2,
            city: next.city,
            state: next.state,
            postal_code: next.zip
        }).some(([key, value]) => (person[key] || '') !== (value || ''));

    if (!changed) return;

    updateStmt.run(
        next.email,
        next.phonePrimary,
        next.phoneSecondary,
        next.address1,
        next.address2,
        next.city,
        next.state,
        next.zip,
        usePerson ? person.person_id : person.id
    );
    updated += 1;
});

console.log(`Processed ${rows.length} rows. Matched ${matched}. Updated ${updated}. Skipped ${skipped}.`);
