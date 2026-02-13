import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';
import { sqlite as db } from '../server/db.js';

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
                amount: '1000.00',
                sourceToken: 'PayPal'
            });
            assert.equal(base, '2026.02.13 PayPal Woodall 1000.00');
        }
    },
    {
        name: 'Website contribution parser ignores HTML entities and captures amount',
        run: async () => {
            const text = [
                'Name:&nbsp;',
                'Elizabeth Woodall',
                'I would like my donation to be allocated to:&nbsp;',
                '2026 Pledge Payment',
                'Sub Total&nbsp;$100.00'
            ].join('\n');
            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: text,
                envelopeFallback: 'EN-204'
            });
            assert.equal(result.donor, 'Elizabeth Woodall');
            assert.equal(result.designation, '2026 pledge');
            assert.equal(result.amount, '100.00');
        }
    },
    {
        name: 'Contribution auto-detect recognizes office sender and BofA body',
        run: async () => {
            const fromOffice = __TEST__.isContributionEmail(
                { from: 'Office <office@saintedmunds.com>' },
                'Any body'
            );
            const bofaBody = __TEST__.isContributionEmail(
                { from: 'alerts@example.com' },
                'Sara Edwards sent you $1,000.00 View your balance'
            );
            assert.equal(fromOffice, true);
            assert.equal(bofaBody, true);
        }
    },
    {
        name: 'Contribution source token maps office and BofA senders',
        run: async () => {
            assert.equal(__TEST__.getContributionSourceToken('Office <office@saintedmunds.org>'), 'PayPal');
            assert.equal(__TEST__.getContributionSourceToken('Bank of America <customerservice@ealerts.bankofamerica.com>'), 'Zelle');
        }
    },
    {
        name: 'Contribution filename uses donor last name only',
        run: async () => {
            assert.equal(__TEST__.extractDonorLastName('Elizabeth Woodall'), 'Woodall');
            assert.equal(__TEST__.extractDonorLastName('Sara Edwards Jr.'), 'Edwards');
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
