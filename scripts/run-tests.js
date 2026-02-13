import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';

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
        }
    },
    {
        name: 'Bank of America format defaults designation to NPO',
        run: async () => {
            const text = await readFixture('contribution-format-bofa-no-designation.txt');
            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: text,
                envelopeFallback: ''
            });
            assert.equal(result.donor, 'Sara Edwards');
            assert.equal(result.designation, 'NPO');
        }
    }
];

const run = async () => {
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
