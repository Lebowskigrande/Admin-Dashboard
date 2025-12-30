import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'church.db'));

console.log('--- Database Status Report ---');

const categories = db.prepare('SELECT count(*) as count FROM event_categories').get();
console.log('Event Categories:', categories.count);

const types = db.prepare('SELECT count(*) as count FROM event_types').get();
console.log('Event Types:', types.count);

const totalCustom = db.prepare('SELECT count(*) as count FROM custom_events').get();
console.log('Total Custom Events:', totalCustom.count);

const googleCached = db.prepare("SELECT count(*) as count FROM custom_events WHERE source = 'google'").get();
console.log('Google Events (Cached):', googleCached.count);

const syncLog = db.prepare('SELECT * FROM sync_log').all();
console.log('Sync Log:', JSON.stringify(syncLog, null, 2));

if (googleCached.count > 0) {
    const sample = db.prepare("SELECT * FROM custom_events WHERE source = 'google' LIMIT 1").get();
    console.log('Sample Cached Google Event:', JSON.stringify(sample, null, 2));
}
