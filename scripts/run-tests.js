import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';
import { __TEST__ as __CC_TEST__ } from '../server/services/constantContactService.js';
import { __TEST__ as TASK_ROUTE_TEST } from '../server/routes/tasks.js';
import { sqlite as db } from '../server/db.js';
import { validateRuntimeConfig, __TEST__ as configTest } from '../server/config/runtimeConfig.js';
import { __TEST__ as adminAuditTest } from '../server/helpers/adminAudit.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

const readFixture = async (name) => readFile(join(fixturesDir, name), 'utf8');

const tests = [
    {
        name: 'Website contribution format parses donor + normalized designation',
        run: async () => {
            const text = await readFixture('contribution-format-website.txt');
            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: text,
                envelopeFallback: ''
            });
            assert.equal(result.donor, 'Elizabeth Woodall');
            assert.equal(result.designation, '2026 pledge');
            assert.equal(result.amount, '100.00');
        }
    },
    {
        name: 'Bank of America format parses donor + designation',
        run: async () => {
            const text = await readFixture('contribution-format-bofa-with-designation.txt');
            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: text,
                envelopeFallback: ''
            });
            assert.equal(result.donor, 'Sara Edwards');
            assert.equal(result.designation, 'Pledge for January');
            assert.equal(result.amount, '1000.00');
        }
    },
    {
        name: 'Bank of America format defaults designation to NPO',
        run: async () => {
            const text = await readFixture('contribution-format-bofa-no-designation.txt');
            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: text,
                envelopeFallback: 'EN-204'
            });
            assert.equal(result.donor, 'Sara Edwards');
            assert.equal(result.designation, 'NPO');
            assert.equal(result.envelopeNumber, 'EN-204');
            assert.equal(result.amount, '1000.00');
        }
    },
    {
        name: 'Contribution note format includes clean envelope and designation',
        run: async () => {
            const note = __TEST__.buildNoteText({}, {
                routeKind: 'CONTRIBUTION',
                donor: 'Ignored Donor',
                envelopeNumber: 'EN-204',
                designation: 'Pledge for January'
            });
            assert.equal(note, 'Envelope: EN-204 | Designation: Pledge for January');
        }
    },
    {
        name: 'Contribution filename base includes date donor and amount',
        run: async () => {
            const base = __TEST__.formatContributionFilenameBase({
                timestamp: new Date('2026-02-13T10:15:00.000Z'),
                donor: 'Elizabeth Woodall',
                amount: '1000.00'
            });
            assert.equal(base, '2026.02.13 Elizabeth Woodall 1000.00');
        }
    },
    {
        name: 'Constant Contact email validator accepts complete Sunday payload',
        run: async () => {
            const result = __CC_TEST__.validateEmailInput({
                date: 'February 15, 2026',
                sundayName: 'Last Sunday after Epiphany',
                youtubeLink: 'https://youtube.com/live/example',
                pdfUrl: 'https://dropbox.example/bulletin.pdf',
                imageUrl: 'https://dropbox.example/preview.png'
            });
            assert.equal(result.date, 'February 15, 2026');
            assert.equal(result.testEmpty, false);
        }
    },
    {
        name: 'Constant Contact email validator rejects missing required fields',
        run: async () => {
            assert.throws(
                () => __CC_TEST__.validateEmailInput({
                    date: 'February 15, 2026',
                    sundayName: 'Last Sunday after Epiphany',
                    youtubeLink: '',
                    pdfUrl: '',
                    imageUrl: ''
                }),
                /Missing email data/
            );
        }
    },
    {
        name: 'Task route normalizes explicit valid task states',
        run: async () => {
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState('open'), 'open');
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState('in_progress'), 'in_progress');
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState('blocked'), 'blocked');
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState('done'), 'done');
        }
    },
    {
        name: 'Task route falls back when task state is invalid',
        run: async () => {
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState('invalid-state', 'blocked'), 'blocked');
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState('', 'open'), 'open');
            assert.equal(TASK_ROUTE_TEST.normalizeTaskState(null, 'not-real'), 'open');
        }
    },
    {
        name: 'Runtime config strict mode flags missing required variables',
        run: async () => {
            const result = validateRuntimeConfig({}, { strict: true });
            assert.equal(result.ok, false);
            assert.ok(result.errors.some((item) => item.includes('Missing required environment variable: GOOGLE_CLIENT_ID')));
        }
    },
    {
        name: 'Runtime config parser reads ShareFile base paths from JSON',
        run: async () => {
            const parsed = configTest.parseSharefileRouterBases('{"budget":"C:\\\\AP","envelope":"D:\\\\AR"}');
            assert.equal(parsed.parseError, '');
            assert.equal(parsed.bases.budget, 'C:\\AP');
            assert.equal(parsed.bases.envelope, 'D:\\AR');
        }
    },
    {
        name: 'Admin confirmation matching is case-insensitive and trimmed',
        run: async () => {
            const ok = adminAuditTest.hasRequiredConfirmation('  restore database  ', 'RESTORE DATABASE');
            assert.equal(ok, true);
        }
    }
];

const ensureTestSchema = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS people (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            envelope_number TEXT,
            tags TEXT
        )
    `);
    const columns = db.prepare('PRAGMA table_info(people)').all().map((row) => row.name);
    if (!columns.includes('tags')) {
        db.exec('ALTER TABLE people ADD COLUMN tags TEXT');
    }
};

const run = async () => {
    ensureTestSchema();
    let failed = 0;
    for (const testCase of tests) {
        try {
            await testCase.run();
            console.log(`PASS: ${testCase.name}`);
        } catch (error) {
            failed += 1;
            console.error(`FAIL: ${testCase.name}`);
            console.error(error?.stack || error);
        }
    }

    console.log(`\nTest summary: ${tests.length - failed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
};

run().catch((error) => {
    console.error('Test runner failed:', error);
    process.exitCode = 1;
});
