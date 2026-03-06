import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';
import { __TEST__ as AP_VENDOR_TEST } from '../server/services/apVendorExtractor.js';
import { sqlite as db } from '../server/db.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

const readFixture = async (name) => readFile(join(fixturesDir, name), 'utf8');
const rawArgs = process.argv.slice(2).map((arg) => String(arg || '').trim());
const cliArgs = new Set(rawArgs.map((arg) => arg.toLowerCase()));
const vendorOnlyMode = cliArgs.has('--vendor-only') || cliArgs.has('vendor');
const nameFilterArg = rawArgs.find((arg) => arg.toLowerCase().startsWith('--match='));
const testNameFilter = nameFilterArg ? nameFilterArg.slice('--match='.length).trim().toLowerCase() : '';

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
            assert.equal(base, '2026.02.13 PayPal Woodall $1000');
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
    },
    {
        name: 'Contribution filename keeps cents only when non-zero',
        run: async () => {
            const whole = __TEST__.formatContributionFilenameBase({
                timestamp: new Date('2026-02-13T10:15:00.000Z'),
                donor: 'Elizabeth Woodall',
                amount: '1000.00',
                sourceToken: 'PayPal'
            });
            const cents = __TEST__.formatContributionFilenameBase({
                timestamp: new Date('2026-02-13T10:15:00.000Z'),
                donor: 'Elizabeth Woodall',
                amount: '1000.50',
                sourceToken: 'PayPal'
            });
            assert.equal(whole, '2026.02.13 PayPal Woodall $1000');
            assert.equal(cents, '2026.02.13 PayPal Woodall $1000.50');
        }
    },
    {
        name: 'Contribution lookup finds envelope from JSON tags by donor name',
        run: async () => {
            db.prepare(`
                INSERT INTO people (id, display_name, tags)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    tags = excluded.tags
            `).run(
                'test-envelope-lookup',
                'Elizabeth Woodall',
                '["env-374","Volunteer"]'
            );

            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: 'Name: Elizabeth Woodall\nSub Total $100.00\nI would like my donation to be allocated to: 2026 Pledge Payment',
                envelopeFallback: ''
            });

            assert.equal(result.envelopeNumber, '374');
        }
    },
    {
        name: 'Contribution lookup uses envelope_number when tags have no envelope token',
        run: async () => {
            db.prepare(`
                INSERT INTO people (id, display_name, envelope_number, tags)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    envelope_number = excluded.envelope_number,
                    tags = excluded.tags
            `).run(
                'test-envelope-column-fallback',
                'Nora Valdez',
                '901',
                '["Volunteer"]'
            );

            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: 'Name: Nora Valdez\nSub Total $100.00\nI would like my donation to be allocated to: 2026 Pledge Payment',
                envelopeFallback: ''
            });

            assert.equal(result.envelopeNumber, '901');
        }
    },
    {
        name: 'Contribution lookup does not stop at exact donor row when envelope tags are empty',
        run: async () => {
            db.prepare(`
                INSERT INTO people (id, display_name, envelope_number, tags)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    envelope_number = excluded.envelope_number,
                    tags = excluded.tags
            `).run(
                'test-envelope-empty-exact-row',
                'Avery Quillstone',
                '',
                '["Volunteer"]'
            );
            db.prepare(`
                INSERT INTO people (id, display_name, envelope_number, tags)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    envelope_number = excluded.envelope_number,
                    tags = excluded.tags
            `).run(
                'test-envelope-last-name-fallback-row',
                'A. Quillstone',
                '',
                '["env-888"]'
            );

            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: 'Name: Avery Quillstone\nSub Total $100.00\nI would like my donation to be allocated to: 2026 Pledge Payment',
                envelopeFallback: ''
            });

            assert.equal(result.envelopeNumber, '888');
        }
    },
    {
        name: 'Contribution lookup links solid fuzzy People match and uses person envelope',
        run: async () => {
            db.prepare(`
                INSERT INTO people (id, display_name, envelope_number, tags)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    envelope_number = excluded.envelope_number,
                    tags = excluded.tags
            `).run(
                'test-envelope-fuzzy-person',
                'Elizabeth A Woodall',
                '',
                '["env-374","Choir"]'
            );

            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: 'Name: Elizabeth Woodall\nSub Total $125.00\nI would like my donation to be allocated to: 2026 Pledge Payment',
                envelopeFallback: ''
            });

            assert.equal(result.envelopeNumber, '374');
            assert.equal(Boolean(String(result.personId || '').trim()), true);
            assert.equal(/woodall/i.test(String(result.personName || '')), true);
            assert.equal(result.personMatchConfidence >= 0.8, true);
        }
    },
    {
        name: 'Contribution lookup avoids weak same-last-name People match',
        run: async () => {
            db.prepare(`
                INSERT INTO people (id, display_name, envelope_number, tags)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    envelope_number = excluded.envelope_number,
                    tags = excluded.tags
            `).run(
                'test-envelope-weak-last-name',
                'Jane Quillstone',
                '',
                '["env-777"]'
            );

            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: 'Name: Carter Quillstone\nSub Total $100.00\nI would like my donation to be allocated to: 2026 Pledge Payment',
                envelopeFallback: ''
            });

            assert.notEqual(result.personId, 'test-envelope-weak-last-name');
            assert.notEqual(result.envelopeNumber, '777');
        }
    },
    {
        name: 'Forwarded contribution uses original metadata/body for donor and date',
        run: async () => {
            const forwarded = [
                'Please route this.',
                '',
                '---------- Forwarded message ---------',
                'From: Bank of America <customerservice@ealerts.bankofamerica.com>',
                'Date: Mon, Dec 12, 2025 at 9:01 AM',
                'Subject: You received money',
                '',
                'Sara Edwards sent you $1,000.00 Pledge for January View your balance'
            ].join('\n');
            const context = __TEST__.resolveContributionContext(
                { from: 'Office <office@saintedmunds.org>', date: 'Fri, Feb 13, 2026 10:00 AM' },
                forwarded
            );

            assert.equal(context.metadata.from, 'Bank of America <customerservice@ealerts.bankofamerica.com>');
            assert.equal(context.metadata.date, 'Mon, Dec 12, 2025 at 9:01 AM');
            const parsed = __TEST__.parseContributionFields({
                metadata: context.metadata,
                bodyText: context.bodyText,
                envelopeFallback: ''
            });
            assert.equal(parsed.donor, 'Sara Edwards');
            assert.equal(parsed.designation, 'Pledge for January');
            assert.equal(parsed.amount, '1000.00');
        }
    },
    {
        name: 'Thread routing picks earliest contribution message',
        run: async () => {
            const threadMessages = [
                {
                    id: 'm-new',
                    internalDate: String(new Date('2026-02-13T10:00:00Z').getTime()),
                    snippet: 'Forward note only',
                    payload: { headers: [{ name: 'From', value: 'Staff <office@saintedmunds.org>' }] }
                },
                {
                    id: 'm-old',
                    internalDate: String(new Date('2025-12-12T09:00:00Z').getTime()),
                    snippet: 'Sara Edwards sent you $1,000.00 Pledge for January View your balance',
                    payload: {
                        headers: [
                            { name: 'From', value: 'Bank of America <customerservice@ealerts.bankofamerica.com>' },
                            { name: 'Date', value: 'Mon, Dec 12, 2025 at 9:01 AM' }
                        ]
                    }
                }
            ];

            const selected = __TEST__.selectThreadMessageForRouting(threadMessages, { requireContribution: true });
            assert.equal(selected?.id, 'm-old');
        }
    },
    {
        name: 'Thread routing picks latest non-contribution message',
        run: async () => {
            const threadMessages = [
                {
                    id: 'm-old',
                    internalDate: String(new Date('2026-02-13T09:00:00Z').getTime()),
                    snippet: 'older',
                    payload: { headers: [{ name: 'From', value: 'Vendor <billing@vendor.com>' }] }
                },
                {
                    id: 'm-new',
                    internalDate: String(new Date('2026-02-13T10:00:00Z').getTime()),
                    snippet: 'newer',
                    payload: { headers: [{ name: 'From', value: 'Vendor <billing@vendor.com>' }] }
                }
            ];

            const selected = __TEST__.selectThreadMessageForRouting(threadMessages, { requireContribution: false });
            assert.equal(selected?.id, 'm-new');
        }
    },
    {
        name: 'Email header date preserves header calendar day for filename',
        run: async () => {
            const ts = __TEST__.parseEmailHeaderTimestamp('Fri, 14 Feb 2026 00:30:00 +0000');
            const base = __TEST__.formatContributionFilenameBase({
                timestamp: ts,
                donor: 'Sara Edwards',
                amount: '100.00',
                sourceToken: 'Zelle'
            });
            assert.equal(base.startsWith('2026.02.14 Zelle Edwards '), true);
        }
    },
    {
        name: 'AP thread attachment picker prioritizes PDF files only',
        run: async () => {
            const messages = [
                {
                    id: 'm1',
                    internalDate: String(new Date('2026-02-01T10:00:00Z').getTime()),
                    payload: {
                        parts: [
                            { filename: 'invoice.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: { attachmentId: 'a1' } }
                        ]
                    }
                },
                {
                    id: 'm2',
                    internalDate: String(new Date('2026-02-01T11:00:00Z').getTime()),
                    payload: {
                        parts: [
                            { filename: 'invoice.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a2' } }
                        ]
                    }
                }
            ];
            const picked = __TEST__.collectThreadPdfAttachments(messages);
            assert.equal(picked.length, 1);
            assert.equal(picked[0].messageId, 'm2');
            assert.equal(picked[0].attachmentId, 'a2');
        }
    },
    {
        name: 'AP conversation text fallback includes full thread',
        run: async () => {
            const messages = [
                {
                    id: 'm1',
                    internalDate: String(new Date('2026-02-01T10:00:00Z').getTime()),
                    snippet: 'first snippet',
                    payload: { headers: [{ name: 'From', value: 'a@example.com' }, { name: 'Subject', value: 'First' }] }
                },
                {
                    id: 'm2',
                    internalDate: String(new Date('2026-02-01T11:00:00Z').getTime()),
                    snippet: 'second snippet',
                    payload: { headers: [{ name: 'From', value: 'b@example.com' }, { name: 'Subject', value: 'Second' }] }
                }
            ];
            const text = __TEST__.buildConversationText(messages);
            assert.equal(text.includes('first snippet'), true);
            assert.equal(text.includes('second snippet'), true);
            assert.equal(text.includes('Message 1 of 2'), true);
            assert.equal(text.includes('Message 2 of 2'), true);
        }
    },
    {
        name: 'Contribution allows Rent designation without envelope number',
        run: async () => {
            const result = __TEST__.parseContributionFields({
                metadata: {},
                bodyText: 'Name: Test Donor Without Envelope\nSub Total $250.00',
                envelopeFallback: '',
                designationFallback: 'Rent'
            });
            assert.equal(result.designation, 'Rent');
            assert.equal(result.envelopeNumber, '');
            const note = __TEST__.buildNoteText({}, {
                routeKind: 'CONTRIBUTION',
                envelopeNumber: '',
                designation: 'Rent'
            });
            assert.equal(note, 'Designation: Rent');
        }
    },
    {
        name: 'AP vendor extractor detects SoCalGas from content',
        run: async () => {
            const sample = 'From: SoCalGas <customerservice@socalgas.com> Subject: Your bill from SoCalGas is now available';
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, 'SoCalGas');
        }
    },
    {
        name: 'AP vendor extractor detects Hammer Pest Control from invoice body',
        run: async () => {
            const sample = 'Service Notification Hammer Pest Control 1455 Monterey Pass Rd email@hammerpestcontrol.com Invoice';
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, 'Hammer Pest Control');
        }
    },
    {
        name: 'AP vendor extractor detects California American Water from utility body',
        run: async () => {
            const sample = 'From: American Water <Customer_Service@cs.amwater.com> Your California American Water bill is ready';
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, 'California American Water');
        }
    },
    {
        name: 'AP vendor extractor returns no match for unrelated text',
        run: async () => {
            const sample = 'This PDF has no invoice or sender identifiers';
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, '');
        }
    },
    {
        name: 'AP vendor extractor avoids Vertafore from generic subject-only token',
        run: async () => {
            const sample = 'Subject: Document delivery confirmation';
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, '');
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
    const baseTests = vendorOnlyMode
        ? tests.filter((testCase) => /ap vendor extractor/i.test(testCase.name))
        : tests;
    const selectedTests = testNameFilter
        ? baseTests.filter((testCase) => testCase.name.toLowerCase().includes(testNameFilter))
        : baseTests;
    if (selectedTests.length === 0) {
        console.error(`No tests matched filter: "${testNameFilter}"`);
        process.exitCode = 1;
        return;
    }
    let failed = 0;
    for (const testCase of selectedTests) {
        try {
            await testCase.run();
            console.log(`PASS: ${testCase.name}`);
        } catch (error) {
            failed += 1;
            console.error(`FAIL: ${testCase.name}`);
            console.error(error?.stack || error);
        }
    }

    console.log(`\nTest summary: ${selectedTests.length - failed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
};

run().catch((error) => {
    console.error('Test runner failed:', error);
    process.exitCode = 1;
});
