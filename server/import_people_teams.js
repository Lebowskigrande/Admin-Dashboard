import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workbookPath = join(__dirname, '../dashboard people data backup.xlsx');

const ROLE_MAP = {
    'Acolyte': 'acolyte',
    'Altar Guild': 'altarGuild',
    'Building Supervisor': 'buildingSupervisor',
    'Celebrant': 'celebrant',
    'Childcare': 'childcare',
    'Choirmaster': 'choirmaster',
    'LEM': 'lem',
    'Lector': 'lector',
    'Officiant': 'officiant',
    'Organist': 'organist',
    'Preacher': 'preacher',
    'Sound Engineer': 'sound',
    'Thurifer': 'thurifer',
    'Usher': 'usher'
};

const normalizeText = (value) => String(value || '').trim();

const normalizeCategory = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized.startsWith('clergy')) return 'clergy';
    if (normalized.startsWith('staff')) return 'staff';
    if (normalized.startsWith('volunteer')) return 'volunteer';
    return 'volunteer';
};

const parseRoles = (value) => {
    const roles = normalizeText(value)
        .split(',')
        .map((role) => normalizeText(role))
        .filter(Boolean)
        .map((role) => ROLE_MAP[role])
        .filter(Boolean);
    return Array.from(new Set(roles));
};

const parseTeams = (value) => {
    const items = normalizeText(value)
        .split(',')
        .map((item) => normalizeText(item));
    const teamNumbers = items
        .map((item) => {
            const match = item.match(/team\s*(\d+)/i);
            return match ? Number(match[1]) : null;
        })
        .filter((num) => Number.isInteger(num));
    return Array.from(new Set(teamNumbers));
};

const buildDisplayName = (firstName, lastName) => {
    const first = normalizeText(firstName);
    const last = normalizeText(lastName);
    return normalizeText(`${first} ${last}`);
};

const workbook = XLSX.readFile(workbookPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

const people = rows
    .map((row) => {
        const displayName = buildDisplayName(row['First Name'], row['Last Name']);
        if (!displayName) return null;

        const title = normalizeText(row['Title']);
        const extension = normalizeText(row['Extension']);
        const tags = [];
        if (title) tags.push(title);
        if (extension) tags.push(`ext-${extension}`);

        return {
            displayName,
            email: normalizeText(row['Email']),
            category: normalizeCategory(row['Category']),
            roles: parseRoles(row['Eligible Roles']),
            tags,
            teams: {
                lem: parseTeams(row['LEM Team']),
                acolyte: parseTeams(row['Acolyte Team']),
                usher: parseTeams(row['Usher Team'])
            }
        };
    })
    .filter(Boolean);

const slugify = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ensureUniqueId = (baseId) => {
    let candidate = baseId || `person-${Date.now()}`;
    let counter = 2;
    while (db.prepare('SELECT 1 FROM people WHERE id = ?').get(candidate)) {
        candidate = `${baseId}-${counter}`;
        counter += 1;
    }
    return candidate;
};

const insertPerson = db.prepare(`
    INSERT INTO people (id, display_name, email, category, roles, tags, teams)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updatePerson = db.prepare(`
    UPDATE people
    SET display_name = ?, email = ?, category = ?, roles = ?, tags = ?, teams = ?
    WHERE id = ?
`);

const findPerson = db.prepare(`
    SELECT * FROM people
    WHERE LOWER(display_name) = LOWER(?) OR (email <> '' AND LOWER(email) = LOWER(?))
    LIMIT 1
`);

const mergeUnique = (base = [], additions = []) => {
    const set = new Set([...(base || []), ...(additions || [])].filter(Boolean));
    return Array.from(set);
};

const mergeTeams = (base = {}, additions = {}) => {
    const merged = { ...(base || {}) };
    Object.entries(additions || {}).forEach(([key, value]) => {
        merged[key] = mergeUnique(merged[key] || [], value || []);
    });
    return merged;
};

const mergePeople = db.transaction(() => {
    for (const person of people) {
        const existing = findPerson.get(person.displayName, person.email || '');
        if (existing) {
            const nextRoles = mergeUnique(JSON.parse(existing.roles || '[]'), person.roles || []);
            const nextTags = mergeUnique(JSON.parse(existing.tags || '[]'), person.tags || []);
            const existingTeams = JSON.parse(existing.teams || '{}');
            const nextTeams = mergeTeams(existingTeams, person.teams || {});
            updatePerson.run(
                person.displayName || existing.display_name,
                person.email || existing.email || '',
                person.category || existing.category || 'volunteer',
                JSON.stringify(nextRoles),
                JSON.stringify(nextTags),
                JSON.stringify(nextTeams),
                existing.id
            );
        } else {
            const baseId = slugify(person.displayName);
            const id = ensureUniqueId(baseId);
            insertPerson.run(
                id,
                person.displayName,
                person.email,
                person.category,
                JSON.stringify(person.roles || []),
                JSON.stringify(person.tags || []),
                JSON.stringify(person.teams || {})
            );
        }
    }
});

mergePeople();

const teamAssignments = {
    lem: new Map(),
    acolyte: new Map(),
    usher: new Map()
};

const addToTeamMap = (map, teamNumber, name) => {
    if (!map.has(teamNumber)) map.set(teamNumber, []);
    map.get(teamNumber).push(name);
};

people.forEach((person) => {
    person.teams.lem.forEach((team) => addToTeamMap(teamAssignments.lem, team, person.displayName));
    person.teams.acolyte.forEach((team) => addToTeamMap(teamAssignments.acolyte, team, person.displayName));
    person.teams.usher.forEach((team) => addToTeamMap(teamAssignments.usher, team, person.displayName));
});

const sortNames = (names) => names.sort((a, b) => a.localeCompare(b));

const sundays = db.prepare(`
    SELECT date
    FROM liturgical_days
    WHERE CAST(strftime('%w', date) AS INTEGER) = 0
    ORDER BY date
`).all();

const scheduleRows = [];
let currentMonth = '';
let sundayIndex = 0;

sundays.forEach(({ date }) => {
    const monthKey = date.slice(0, 7);
    if (monthKey !== currentMonth) {
        currentMonth = monthKey;
        sundayIndex = 0;
    }

    sundayIndex += 1;
    const teamNumber = sundayIndex;

    const lemNames = teamNumber <= 4 ? teamAssignments.lem.get(teamNumber) || [] : [];
    const acolyteNames = teamNumber <= 4 ? teamAssignments.acolyte.get(teamNumber) || [] : [];
    const usherNames = teamNumber <= 4 ? teamAssignments.usher.get(teamNumber) || [] : [];

    scheduleRows.push({
        date,
        service_time: '10:00',
        lector: '',
        usher: teamNumber <= 4 ? sortNames([...usherNames]).join(', ') : '',
        acolyte: teamNumber <= 4 ? sortNames([...acolyteNames]).join(', ') : '',
        chalice_bearer: teamNumber <= 4 ? sortNames([...lemNames]).join(', ') : '',
        sound_engineer: '',
        coffee_hour: ''
    });
});

db.prepare('DELETE FROM schedule_roles').run();

const insertSchedule = db.prepare(`
    INSERT INTO schedule_roles (
        date, service_time, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertScheduleRows = db.transaction(() => {
    for (const row of scheduleRows) {
        insertSchedule.run(
            row.date,
            row.service_time,
            row.lector,
            row.usher,
            row.acolyte,
            row.chalice_bearer,
            row.sound_engineer,
            row.coffee_hour
        );
    }
});

insertScheduleRows();

console.log(`Imported ${people.length} people.`);
console.log(`Generated ${scheduleRows.length} Sunday schedule rows.`);
