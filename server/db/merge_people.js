import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '..', 'church.db'));

const MERGES = [
    { fromId: 'michael-h', toId: 'michael-harrigian' },
    { fromId: 'michael-m', toId: 'michael-mathis' }
];

const mergeAssignments = db.transaction(() => {
    MERGES.forEach(({ fromId, toId }) => {
        const target = db.prepare('SELECT id FROM people WHERE id = ?').get(toId);
        if (!target) return;
        db.prepare('UPDATE assignments SET person_id = ? WHERE person_id = ?').run(toId, fromId);
        const remaining = db.prepare('SELECT count(*) as count FROM assignments WHERE person_id = ?').get(fromId).count;
        if (remaining === 0) {
            db.prepare('DELETE FROM people WHERE id = ?').run(fromId);
        }
    });
});

mergeAssignments();
console.log('Merged Michael H/M records into canonical people.');
