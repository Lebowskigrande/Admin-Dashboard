import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';
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
