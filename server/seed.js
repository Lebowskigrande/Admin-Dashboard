import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import db from './db.js';
import { PEOPLE } from '../src/data/people.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const liturgicalPath = path.join(__dirname, '../src/data/liturgical_calendar_2026.json');
const schedulePath = path.join(__dirname, '../src/data/service_schedule.json');
const peopleWorkbookPath = path.join(__dirname, '../dashboard people data.xlsx');

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

const loadPeopleFromWorkbook = () => {
    if (!fs.existsSync(peopleWorkbookPath)) return [];
    const workbook = XLSX.readFile(peopleWorkbookPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    return rows
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
};

const buildTeamAssignments = (people) => {
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
        person.teams?.lem?.forEach((team) => addToTeamMap(teamAssignments.lem, team, person.displayName));
        person.teams?.acolyte?.forEach((team) => addToTeamMap(teamAssignments.acolyte, team, person.displayName));
        person.teams?.usher?.forEach((team) => addToTeamMap(teamAssignments.usher, team, person.displayName));
    });

    return teamAssignments;
};

export const seedDatabase = () => {
    const hasTable = (name) => {
        const row = db.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
        `).get(name);
        return !!row;
    };
    const liturgicalCount = db.prepare('SELECT count(*) as count FROM liturgical_days').get().count;

    if (liturgicalCount === 0) {
        console.log('Seeding liturgical data...');
        const liturgicalData = JSON.parse(fs.readFileSync(liturgicalPath, 'utf8'));

        const insert = db.prepare(`
            INSERT INTO liturgical_days (date, feast, color, readings)
            VALUES (@date, @feast, @color, @readings)
        `);

        const insertMany = db.transaction((days) => {
            for (const day of days) insert.run(day);
        });

        insertMany(liturgicalData);
        console.log(`Inserted ${liturgicalData.length} liturgical days.`);
    }

    const scheduleCount = hasTable('schedule_roles')
        ? db.prepare('SELECT count(*) as count FROM schedule_roles').get().count
        : 0;

    if (scheduleCount === 0 && hasTable('schedule_roles')) {
        const workbookPeople = loadPeopleFromWorkbook();
        if (workbookPeople.length) {
            console.log('Seeding schedule data from teams...');
            const teamAssignments = buildTeamAssignments(workbookPeople);
            const sortNames = (names) => names.sort((a, b) => a.localeCompare(b));

            const sundays = db.prepare(`
                SELECT date
                FROM liturgical_days
                WHERE CAST(strftime('%w', date) AS INTEGER) = 0
                ORDER BY date
            `).all();

            let currentMonth = '';
            let sundayIndex = 0;

            const insert = db.prepare(`
                INSERT INTO schedule_roles (date, service_time, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const insertMany = db.transaction(() => {
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

                    insert.run(
                        date,
                        '10:00',
                        '',
                        teamNumber <= 4 ? sortNames([...usherNames]).join(', ') : '',
                        teamNumber <= 4 ? sortNames([...acolyteNames]).join(', ') : '',
                        teamNumber <= 4 ? sortNames([...lemNames]).join(', ') : '',
                        '',
                        ''
                    );
                });
            });

            insertMany();
            console.log(`Inserted ${sundays.length} schedule entries from teams.`);
        } else {
            console.log('Seeding schedule data from JSON...');
            const scheduleData = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));

            const insert = db.prepare(`
                INSERT INTO schedule_roles (date, service_time, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour)
                VALUES (@date, @serviceTime, @lector, @usher, @acolyte, @chaliceBearer, @soundEngineer, @coffeeHour)
            `);

            // Group by date to determine time
            const grouped = {};
            scheduleData.forEach(entry => {
                if (!grouped[entry.date]) grouped[entry.date] = [];
                grouped[entry.date].push(entry);
            });

            const insertMany = db.transaction(() => {
                Object.entries(grouped).forEach(([date, entries]) => {
                    entries.forEach((entry, index) => {
                        let time = '10:00';
                        if (entries.length >= 2) {
                            time = index === 0 ? '08:00' : '10:00';
                        }

                        insert.run({
                            date: entry.date,
                            serviceTime: time,
                            lector: entry.roles.lector || '',
                            usher: entry.roles.usher || '',
                            acolyte: entry.roles.acolyte || '',
                            chaliceBearer: entry.roles.chaliceBearer || '',
                            soundEngineer: entry.roles.sound || '',
                            coffeeHour: entry.roles.coffeeHour || ''
                        });
                    });
                });
            });

            insertMany();
            console.log(`Inserted ${scheduleData.length} schedule entries.`);
        }
    }

    const peopleCount = db.prepare('SELECT count(*) as count FROM people').get().count;

    if (peopleCount === 0) {
        console.log('Seeding people data...');
        const workbookPeople = loadPeopleFromWorkbook();
        const sourcePeople = workbookPeople.length ? workbookPeople : PEOPLE;
        const insert = db.prepare(`
            INSERT INTO people (id, display_name, email, category, roles, tags, teams)
            VALUES (@id, @displayName, @email, @category, @roles, @tags, @teams)
        `);

        const insertMany = db.transaction((rows) => {
            for (const person of rows) {
                insert.run({
                    id: person.id || person.displayName?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    displayName: person.displayName,
                    email: person.email || '',
                    category: person.category || '',
                    roles: JSON.stringify(person.roles || []),
                    tags: JSON.stringify(person.tags || []),
                    teams: JSON.stringify(person.teams || {})
                });
            }
        });

        insertMany(sourcePeople);
        console.log(`Inserted ${sourcePeople.length} people.`);
    }

    const buildingCount = db.prepare('SELECT count(*) as count FROM buildings').get().count;

    if (buildingCount === 0) {
        console.log('Seeding building data...');
        const buildings = [
            {
                id: 'sanctuary',
                name: 'Church',
                category: 'Worship',
                capacity: 350,
                size_sqft: 6800,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 0,
                event_types: ['worship', 'wedding', 'funeral', 'concert'],
                notes: 'Primary worship space with choir loft and sacristy access.'
            },
            {
                id: 'chapel',
                name: 'Chapel',
                category: 'Worship',
                capacity: 80,
                size_sqft: 1200,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 0,
                event_types: ['weekday-worship', 'small-wedding', 'prayer'],
                notes: 'Quiet weekday services and intimate gatherings.'
            },
            {
                id: 'parish-hall',
                name: 'Fellows Hall',
                category: 'All Purpose',
                capacity: 200,
                size_sqft: 3200,
                rental_rate_hour: 150,
                rental_rate_day: 900,
                parking_spaces: 0,
                event_types: ['reception', 'meeting', 'class', 'community'],
                notes: 'Fellowship hall with stage, AV hookups, and kitchen access.'
            },
            {
                id: 'office',
                name: 'Office/School',
                category: 'All Purpose',
                capacity: 120,
                size_sqft: 2400,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 0,
                event_types: ['meeting', 'class', 'administration'],
                notes: 'Administration offices, classrooms, and workroom.'
            },
            {
                id: 'parking-north',
                name: 'North Lot',
                category: 'Parking',
                capacity: 0,
                size_sqft: 0,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 48,
                event_types: ['parking'],
                notes: 'Primary parking lot with ADA spaces.'
            },
            {
                id: 'parking-south',
                name: 'South Lot',
                category: 'Parking',
                capacity: 0,
                size_sqft: 0,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 24,
                event_types: ['parking', 'service-access'],
                notes: 'Overflow lot and service access.'
            },
            {
                id: 'playground',
                name: 'Playground',
                category: 'Grounds',
                capacity: 0,
                size_sqft: 0,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 0,
                event_types: ['children', 'outdoor'],
                notes: 'Outdoor play area and family gathering space.'
            },
            {
                id: 'close',
                name: 'Close',
                category: 'Grounds',
                capacity: 0,
                size_sqft: 0,
                rental_rate_hour: 0,
                rental_rate_day: 0,
                parking_spaces: 0,
                event_types: ['garden', 'outdoor'],
                notes: 'Green space, garden beds, and footpaths.'
            }
        ];

        const insert = db.prepare(`
            INSERT INTO buildings (
                id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
            ) VALUES (
                @id, @name, @category, @capacity, @size_sqft, @rental_rate_hour, @rental_rate_day, @parking_spaces, @event_types, @notes
            )
        `);

        const insertMany = db.transaction((rows) => {
            for (const building of rows) {
                insert.run({
                    ...building,
                    event_types: JSON.stringify(building.event_types || [])
                });
            }
        });

        insertMany(buildings);
        console.log(`Inserted ${buildings.length} buildings.`);
    }
};
