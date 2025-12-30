import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'church.db');
const db = new Database(dbPath);

// Create tables
// Create base tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS liturgical_days (
        date TEXT PRIMARY KEY,
        feast TEXT,
        color TEXT,
        readings TEXT
    );
`);

// Simple migration runner
const runMigrations = () => {
    try {
        // Execute 001 if not already done (Google tokens)
        const migration1 = `
            CREATE TABLE IF NOT EXISTS google_tokens (
                id INTEGER PRIMARY KEY,
                access_token TEXT,
                refresh_token TEXT,
                expiry_date INTEGER
            );
            CREATE TABLE IF NOT EXISTS selected_calendars (
                calendar_id TEXT PRIMARY KEY,
                summary TEXT,
                background_color TEXT
            );
        `;
        db.exec(migration1);

        // Execute 002 (Events Engine)
        const migration2 = `
            CREATE TABLE IF NOT EXISTS event_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                color TEXT NOT NULL,
                description TEXT,
                icon TEXT
            );

            CREATE TABLE IF NOT EXISTS event_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                category_id INTEGER,
                color TEXT,
                requires_contract BOOLEAN DEFAULT 0,
                requires_staffing BOOLEAN DEFAULT 0,
                requires_setup BOOLEAN DEFAULT 0,
                is_public BOOLEAN DEFAULT 1,
                FOREIGN KEY (category_id) REFERENCES event_categories(id)
            );

            CREATE TABLE IF NOT EXISTS custom_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                event_type_id INTEGER,
                date TEXT NOT NULL,
                time TEXT,
                end_time TEXT,
                location TEXT,
                metadata TEXT,
                source TEXT DEFAULT 'manual',
                external_id TEXT UNIQUE,
                FOREIGN KEY (event_type_id) REFERENCES event_types(id)
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                calendar_id TEXT,
                last_sync TEXT,
                status TEXT
            );
        `;
        db.exec(migration2);

        // Seed initial data if categories are empty
        const categoryCount = db.prepare('SELECT count(*) as count FROM event_categories').get().count;
        if (categoryCount === 0) {
            db.exec(`
                INSERT INTO event_categories (name, slug, color, description) VALUES 
                ('Liturgical', 'liturgical', '#15803d', 'Principal worship and liturgical observances'),
                ('Sacramental', 'sacramental', '#FFD700', 'Baptisms, Weddings, Funerals, etc.'),
                ('Administrative', 'administrative', '#3B82F6', 'Meetings, rehearsals, and staff business'),
                ('Educational', 'educational', '#14B8A6', 'Classes, formation, and study groups'),
                ('Cultural', 'cultural', '#A855F7', 'Concerts, lectures, and community arts'),
                ('Commercial', 'commercial', '#F97316', 'Facility rentals and external contracts'),
                ('Pastoral', 'pastoral', '#EC4899', 'Counseling, prep, and pastoral care'),
                ('Operational', 'operational', '#6B7280', 'Maintenance, closures, and cleaning');

                INSERT INTO event_types (name, slug, category_id, requires_contract, requires_staffing, requires_setup) VALUES
                ('Weekly Service', 'weekly-service', 1, 0, 1, 1),
                ('Special Service', 'special-service', 1, 0, 1, 1),
                ('Wedding', 'wedding', 2, 1, 1, 1),
                ('Funeral', 'funeral', 2, 0, 1, 1),
                ('Meeting', 'meeting', 3, 0, 0, 0),
                ('Rehearsal', 'rehearsal', 3, 0, 0, 1),
                ('Class / Formation', 'class-formation', 4, 0, 0, 0),
                ('Concert', 'concert', 5, 1, 1, 1),
                ('Private Rental', 'private-rental', 6, 1, 0, 1),
                ('Maintenance / Closure', 'maintenance-closure', 8, 0, 0, 0);
            `);
        }
    } catch (err) {
        console.error('Migration failed:', err.message);
    }
};

runMigrations();

db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        service_time TEXT,
        lector TEXT,
        usher TEXT,
        acolyte TEXT,
        chalice_bearer TEXT,
        sound_engineer TEXT,
        coffee_hour TEXT
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
        id INTEGER PRIMARY KEY,
        access_token TEXT,
        refresh_token TEXT,
        expiry_date INTEGER
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS selected_calendars (
        calendar_id TEXT PRIMARY KEY,
        summary TEXT,
        background_color TEXT
    );
`);

console.log('Database initialized at', dbPath);

export default db;
