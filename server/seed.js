import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

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
};
