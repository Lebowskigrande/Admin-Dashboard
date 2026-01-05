import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { PEOPLE } from '../src/data/people.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const liturgicalPath = path.join(__dirname, '../src/data/liturgical_calendar_2026.json');
const schedulePath = path.join(__dirname, '../src/data/service_schedule.json');

export const seedDatabase = () => {
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

    const scheduleCount = db.prepare('SELECT count(*) as count FROM schedule_roles').get().count;

    if (scheduleCount === 0) {
        console.log('Seeding schedule data...');
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
                    // Logic: If 2 entries, first is 8am, second is 10am. 
                    // If 1 entry, assume 10am (principal service) unless specified otherwise 
                    // (User said "10am service... 8am..."). 
                    // Let's stick to the rotation logic: 1st=8am, 2nd=10am (if 2 exist).

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

    const peopleCount = db.prepare('SELECT count(*) as count FROM people').get().count;

    if (peopleCount === 0) {
        console.log('Seeding people data...');
        const insert = db.prepare(`
            INSERT INTO people (id, display_name, email, category, roles, tags)
            VALUES (@id, @displayName, @email, @category, @roles, @tags)
        `);

        const insertMany = db.transaction((rows) => {
            for (const person of rows) {
                insert.run({
                    id: person.id,
                    displayName: person.displayName,
                    email: person.email || '',
                    category: person.category || '',
                    roles: JSON.stringify(person.roles || []),
                    tags: JSON.stringify(person.tags || [])
                });
            }
        });

        insertMany(PEOPLE);
        console.log(`Inserted ${PEOPLE.length} people.`);
    }

    const buildingCount = db.prepare('SELECT count(*) as count FROM buildings').get().count;

    if (buildingCount === 0) {
        console.log('Seeding building data...');
        const buildings = [
            {
                id: 'church',
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
                id: 'fellows-hall',
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
                id: 'office-school',
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
                id: 'north-lot',
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
                id: 'south-lot',
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
