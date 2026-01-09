import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '..', 'church.db'));

const DEFAULT_ORGANIST_ID = 'rob-hovencamp';

const ROLE_KEY_MAP = new Map([
    ['acolyte', 'acolyte'],
    ['lector', 'lector'],
    ['lem', 'lem'],
    ['usher', 'usher'],
    ['celebrant', 'celebrant'],
    ['preacher', 'preacher'],
    ['organist', 'organist'],
    ['sound', 'sound'],
    ['coffeehour', 'coffeeHour'],
    ['coffee hour', 'coffeeHour'],
    ['coffee_hour', 'coffeeHour'],
    ['chalice_bearer', 'lem'],
    ['chalicebearer', 'lem'],
    ['sound engineer', 'sound'],
    ['sound_engineer', 'sound'],
    ['soundengineer', 'sound']
]);

const normalizeRoleKey = (value) => {
    if (!value) return '';
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    return ROLE_KEY_MAP.get(lower) || ROLE_KEY_MAP.get(raw) || raw;
};

const ensurePerson = (id, name, category = 'staff') => {
    const existing = db.prepare('SELECT id FROM people WHERE id = ?').get(id);
    if (existing) return;
    db.prepare(`
        INSERT INTO people (id, display_name, email, category, roles, tags, teams)
        VALUES (?, ?, '', ?, '[]', '[]', '{}')
    `).run(id, name, category);
};

const deleteAssignmentsForRole = db.prepare('DELETE FROM assignments WHERE occurrence_id = ? AND role_key = ?');
const insertAssignment = db.prepare(`
    INSERT INTO assignments (id, occurrence_id, role_key, person_id)
    VALUES (?, ?, ?, ?)
`);

const normalizeRoles = () => {
    const roles = db.prepare('SELECT DISTINCT role_key FROM assignments').all();
    roles.forEach(({ role_key }) => {
        const normalized = normalizeRoleKey(role_key);
        if (normalized && normalized !== role_key) {
            db.prepare('UPDATE assignments SET role_key = ? WHERE role_key = ?').run(normalized, role_key);
        }
    });
};

const cleanNumericPeople = () => {
    const numericPeople = db.prepare(`
        SELECT id, display_name FROM people
        WHERE display_name GLOB '[0-9]*' AND display_name NOT GLOB '*[A-Za-z]*'
           OR display_name GLOB '[0-9]*-[0-9]*'
    `).all();
    numericPeople.forEach((person) => {
        db.prepare('DELETE FROM assignments WHERE person_id = ?').run(person.id);
        const remaining = db.prepare('SELECT count(*) as count FROM assignments WHERE person_id = ?').get(person.id).count;
        if (remaining === 0) {
            db.prepare('DELETE FROM people WHERE id = ?').run(person.id);
        }
    });
};

const migrateInitials = () => {
    const initials = db.prepare(`
        SELECT id, display_name FROM people
        WHERE display_name GLOB '*.'
    `).all();
    initials.forEach((person) => {
        const match = person.display_name.match(/^([A-Za-z]+)\\s+([A-Za-z])\\.$/);
        if (!match) return;
        const [_, first, initial] = match;
        const candidates = db.prepare(`
            SELECT id, display_name FROM people
            WHERE id <> ?
              AND LOWER(display_name) LIKE ?
              AND LOWER(display_name) LIKE ?
        `).all(person.id, `${first.toLowerCase()}%`, `% ${initial.toLowerCase()}%`);
        if (candidates.length !== 1) return;
        const target = candidates[0];
        db.prepare('UPDATE assignments SET person_id = ? WHERE person_id = ?').run(target.id, person.id);
        const remaining = db.prepare('SELECT count(*) as count FROM assignments WHERE person_id = ?').get(person.id).count;
        if (remaining === 0) {
            db.prepare('DELETE FROM people WHERE id = ?').run(person.id);
        }
    });
};

const assignRobOrganist = () => {
    ensurePerson(DEFAULT_ORGANIST_ID, 'Rob Hovencamp', 'staff');
    const occurrences = db.prepare(`
        SELECT id FROM event_occurrences WHERE event_id = 'sunday-service'
    `).all();
    occurrences.forEach((occurrence) => {
        deleteAssignmentsForRole.run(occurrence.id, 'organist');
        insertAssignment.run(`asgn-${randomUUID()}`, occurrence.id, 'organist', DEFAULT_ORGANIST_ID);
    });
};

db.transaction(() => {
    normalizeRoles();
    cleanNumericPeople();
    migrateInitials();
    assignRobOrganist();
})();

console.log('Assignments cleaned; organist set for all Sunday services.');
