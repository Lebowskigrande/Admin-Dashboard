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
});

test('defaults designation to NPO when Bank of America designation is absent', async () => {
    const text = await readFixture('contribution-format-bofa-no-designation.txt');
    const result = __TEST__.parseContributionFields({
        metadata: {},
        bodyText: text,
        envelopeFallback: ''
    });

    assert.equal(result.donor, 'Sara Edwards');
    assert.equal(result.designation, 'NPO');
});
