import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

const readFixture = async (name) => (
    readFile(join(fixturesDir, name), 'utf8')
);

test('parses donor and designation from website contribution format', async () => {
    const text = await readFixture('contribution-format-website.txt');
    const result = __TEST__.parseContributionFields({
        metadata: {},
        bodyText: text,
        envelopeFallback: ''
    });

    assert.equal(result.donor, 'Elizabeth Woodall');
    assert.equal(result.designation, '2026 pledge');
    assert.equal(result.amount, '100.00');
});

test('parses donor and inline designation from Bank of America format', async () => {
    const text = await readFixture('contribution-format-bofa-with-designation.txt');
    const result = __TEST__.parseContributionFields({
        metadata: {},
        bodyText: text,
        envelopeFallback: ''
    });

    assert.equal(result.donor, 'Sara Edwards');
    assert.equal(result.designation, 'Pledge for January');
    assert.equal(result.amount, '1000.00');
});

test('defaults designation to NPO when Bank of America designation is absent', async () => {
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
});

test('builds clean contribution note with envelope and designation only', async () => {
    const note = __TEST__.buildNoteText({}, {
        routeKind: 'CONTRIBUTION',
        donor: 'Ignored Donor',
        envelopeNumber: 'EN-204',
        designation: 'Pledge for January'
    });

    assert.equal(note, 'Envelope: EN-204 | Designation: Pledge for January');
});

test('builds contribution filename base with date donor and amount', async () => {
    const base = __TEST__.formatContributionFilenameBase({
        timestamp: new Date('2026-02-13T10:15:00.000Z'),
        donor: 'Elizabeth Woodall',
        amount: '1000.00'
    });

    assert.equal(base, '2026.02.13 Elizabeth Woodall 1000.00');
});

test('parses website contribution with html entities and amount', async () => {
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
});

test('detects contribution emails from office sender and bofa body pattern', async () => {
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
});
