import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { __TEST__ } from '../server/services/sharefileEmailRouter.js';
import { __TEST__ as AP_VENDOR_TEST } from '../server/services/apVendorExtractor.js';
import {
    buildTaskProgressAudit,
    listTaskProgressHistory,
    recordTaskProgressHistory
} from '../server/helpers/task-progress-history.js';
import { buildOriginRollups } from '../server/services/taskEngine.js';
import { sqlite as db } from '../server/db.js';
import {
    getTicketDueMeta,
    normalizeTicketRecord,
    normalizeTicketStatus,
    summarizeTickets
} from '../shared/tickets.js';
import {
    buildOrdersSnapshot,
    linkManualOrdersToEmailPackages,
    normalizeOrderItemRecord,
    normalizeOrderItemStatus,
    normalizePurchaseOrderStatus
} from '../shared/orders.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');
const TEST_TASK_HISTORY_PREFIX = 'test-taskhist-';

const readFixture = async (name) => readFile(join(fixturesDir, name), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rawArgs = process.argv.slice(2).map((arg) => String(arg || '').trim());
const cliArgs = new Set(rawArgs.map((arg) => arg.toLowerCase()));
const vendorOnlyMode = cliArgs.has('--vendor-only') || cliArgs.has('vendor');
const nameFilterArg = rawArgs.find((arg) => arg.toLowerCase().startsWith('--match='));
const testNameFilter = nameFilterArg ? nameFilterArg.slice('--match='.length).trim().toLowerCase() : '';

const tests = [
    {
        name: 'Task origin rollups choose the best next task across separate lists',
        run: async () => {
            const [rollup] = buildOriginRollups([
                {
                    id: 'task-bulletin-draft',
                    text: 'Draft bulletin',
                    completed: false,
                    state: 'open',
                    origin_type: 'event',
                    origin_id: 'occ-rollup-test',
                    list_key: 'bulletin',
                    list_mode: 'progressive',
                    step_order: 10,
                    priority_effective: 35,
                    created_at: '2026-04-01T09:00:00.000Z'
                },
                {
                    id: 'task-bulletin-review',
                    text: 'Review bulletin',
                    completed: false,
                    state: 'open',
                    origin_type: 'event',
                    origin_id: 'occ-rollup-test',
                    list_key: 'bulletin',
                    list_mode: 'progressive',
                    step_order: 20,
                    priority_effective: 40,
                    created_at: '2026-04-01T09:05:00.000Z'
                },
                {
                    id: 'task-service-setup',
                    text: 'Confirm service setup',
                    completed: false,
                    state: 'open',
                    origin_type: 'event',
                    origin_id: 'occ-rollup-test',
                    list_key: 'service',
                    list_mode: 'parallel',
                    priority_effective: 80,
                    created_at: '2026-04-01T09:10:00.000Z'
                }
            ]);

            assert.ok(rollup);
            assert.equal(rollup.open_count, 3);
            assert.equal(rollup.next_task?.id, 'task-service-setup');
            assert.equal(rollup.next_task?.text, 'Confirm service setup');
        }
    },
    {
        name: 'Task progress history skips unchanged snapshots',
        run: async () => {
            const taskInstanceId = `${TEST_TASK_HISTORY_PREFIX}no-change`;
            const snapshot = {
                id: taskInstanceId,
                task_id: 'taskdef-no-change',
                title: 'Draft bulletin',
                state: 'open',
                blocked: 0,
                progress_key: 'bulletin-draft',
                progress_steps: [
                    { key: 'bulletin-draft', title: 'Draft bulletin', sort_order: 10 },
                    { key: 'bulletin-review', title: 'Review bulletin', sort_order: 20 }
                ],
                list_key: 'bulletin',
                list_title: 'Bulletin',
                list_mode: 'progressive',
                origin_type: 'event',
                origin_id: 'occ-test-no-change',
                origin_event: 'seed'
            };

            db.prepare('DELETE FROM task_progress_history WHERE task_instance_id = ?').run(taskInstanceId);
            try {
                const result = recordTaskProgressHistory({
                    before: snapshot,
                    after: { ...snapshot },
                    source: 'test',
                    actor: 'run-tests'
                });
                assert.equal(result, null);
                assert.equal(listTaskProgressHistory(taskInstanceId).length, 0);
            } finally {
                db.prepare('DELETE FROM task_progress_history WHERE task_instance_id = ?').run(taskInstanceId);
            }
        }
    },
    {
        name: 'Task progress history records progress and completion transitions',
        run: async () => {
            const taskInstanceId = `${TEST_TASK_HISTORY_PREFIX}transitions`;
            const progressSteps = [
                { key: 'bulletin-draft', title: 'Draft bulletin', sort_order: 10 },
                { key: 'bulletin-review', title: 'Review bulletin', sort_order: 20 },
                { key: 'bulletin-print', title: 'Print bulletin', sort_order: 30 }
            ];
            const before = {
                id: taskInstanceId,
                task_id: 'taskdef-transitions',
                title: 'Finalize bulletin',
                state: 'open',
                blocked: 0,
                progress_key: 'bulletin-draft',
                progress_steps: progressSteps,
                list_key: 'bulletin',
                list_title: 'Bulletin',
                list_mode: 'progressive',
                origin_type: 'event',
                origin_id: 'occ-test-transitions',
                origin_event: 'bulletin-draft'
            };
            const afterProgress = {
                ...before,
                progress_key: 'bulletin-review'
            };
            const completedAt = new Date().toISOString();
            const afterComplete = {
                ...afterProgress,
                state: 'done',
                completed_at: completedAt
            };

            db.prepare('DELETE FROM task_progress_history WHERE task_instance_id = ?').run(taskInstanceId);
            try {
                const progressEntry = recordTaskProgressHistory({
                    before,
                    after: afterProgress,
                    source: 'test',
                    actor: 'run-tests'
                });
                await wait(15);
                const completionEntry = recordTaskProgressHistory({
                    before: afterProgress,
                    after: afterComplete,
                    source: 'test',
                    actor: 'run-tests'
                });

                assert.equal(progressEntry?.action, 'progress');
                assert.equal(progressEntry?.changed_fields.includes('progress_key'), true);
                assert.equal(completionEntry?.action, 'completed');

                const history = listTaskProgressHistory(taskInstanceId, 10);
                assert.equal(history.length, 2);
                assert.equal(history[0].action, 'completed');
                assert.equal(history[0].to_completed_at, completedAt);
                assert.equal(history[1].action, 'progress');
                assert.equal(history[1].changed_fields.includes('progress_key'), true);
                assert.equal(history[1].to_progress_key, 'bulletin-review');
            } finally {
                db.prepare('DELETE FROM task_progress_history WHERE task_instance_id = ?').run(taskInstanceId);
            }
        }
    },
    {
        name: 'Task progress audit flags repetitive final-step clusters',
        run: async () => {
            const now = Date.now();
            const progressSteps = [
                { key: 'draft', title: 'Draft', sort_order: 10 },
                { key: 'review', title: 'Review', sort_order: 20 },
                { key: 'proof', title: 'Proof', sort_order: 30 },
                { key: 'approve', title: 'Approve', sort_order: 40 },
                { key: 'print', title: 'Print', sort_order: 50 }
            ];
            const tasks = [
                {
                    title: 'Finalize bulletin',
                    list_key: 'bulletin',
                    list_title: 'Bulletin',
                    progress_key: 'print',
                    progress_steps: progressSteps,
                    completed_at: new Date(now - (4 * 60 * 1000)).toISOString(),
                    origin_type: 'event',
                    origin_id: 'occ-a'
                },
                {
                    title: 'Finalize bulletin',
                    list_key: 'bulletin',
                    list_title: 'Bulletin',
                    progress_key: 'print',
                    progress_steps: progressSteps,
                    completed_at: new Date(now - (2 * 60 * 1000)).toISOString(),
                    origin_type: 'event',
                    origin_id: 'occ-b'
                },
                {
                    title: 'Finalize bulletin',
                    list_key: 'bulletin',
                    list_title: 'Bulletin',
                    progress_key: 'print',
                    progress_steps: progressSteps,
                    completed_at: new Date(now - (60 * 1000)).toISOString(),
                    origin_type: 'event',
                    origin_id: 'occ-c'
                }
            ];

            const audit = buildTaskProgressAudit(tasks, {
                days: 30,
                cluster_window_minutes: 5,
                min_cluster_size: 3
            });

            assert.equal(audit.suspicious_clusters.length, 1);
            assert.equal(audit.suspicious_clusters[0].progressive_finals.length, 3);
            const recommendation = audit.recommendations.find((entry) => (
                entry.title === 'Finalize bulletin' && entry.list_key === 'bulletin'
            ));
            assert.ok(recommendation);
            assert.equal(recommendation.severity, 'high');
            assert.deepEqual(recommendation.suggested_step_groups, [
                'Draft + Review',
                'Proof + Approve',
                'Print'
            ]);
        }
    },
    {
        name: 'Legacy ticket statuses normalize into the current workflow states',
        run: async () => {
            assert.equal(normalizeTicketStatus('reviewed'), 'open');
            assert.equal(normalizeTicketStatus('in_process'), 'in_progress');
            assert.equal(normalizeTicketStatus('closed'), 'done');
        }
    },
    {
        name: 'Ticket summary tracks overdue and vendorless active tickets',
        run: async () => {
            const tickets = [
                normalizeTicketRecord({
                    id: 'ticket-overdue',
                    status: 'in_process',
                    priority: 'high',
                    vendor_id: '',
                    target_date: '2026-04-08'
                }),
                normalizeTicketRecord({
                    id: 'ticket-blocked',
                    status: 'blocked',
                    priority: 'critical',
                    vendor_id: 'vendor-hvac',
                    target_date: '2026-04-12'
                }),
                normalizeTicketRecord({
                    id: 'ticket-complete',
                    status: 'closed',
                    priority: 'normal'
                })
            ];

            const summary = summarizeTickets(tickets, { today: new Date('2026-04-10T12:00:00Z') });
            assert.equal(summary.total, 3);
            assert.equal(summary.active, 2);
            assert.equal(summary.closed, 1);
            assert.equal(summary.blocked, 1);
            assert.equal(summary.urgent, 2);
            assert.equal(summary.overdue, 1);
            assert.equal(summary.no_vendor, 1);

            const due = getTicketDueMeta(tickets[0], { today: new Date('2026-04-10T12:00:00Z') });
            assert.equal(due.key, 'overdue');
        }
    },
    {
        name: 'Orders module normalizes item and purchase order statuses',
        run: async () => {
            assert.equal(normalizeOrderItemStatus('delivered'), 'received');
            assert.equal(normalizeOrderItemStatus('return requested'), 'return_pending');
            assert.equal(normalizePurchaseOrderStatus('ordered'), 'placed');
            assert.equal(normalizePurchaseOrderStatus('received'), 'delivered');
        }
    },
    {
        name: 'Orders matching links manual requests to matching email package updates',
        run: async () => {
            const items = [
                normalizeOrderItemRecord({
                    id: 'orditem-toner',
                    title: 'Printer toner',
                    requested_by: 'Office',
                    needed_by: '2026-04-12'
                }),
                normalizeOrderItemRecord({
                    id: 'orditem-candles',
                    title: 'Altar candle oil',
                    requested_by: 'Buildings',
                    needed_by: '2026-04-15'
                })
            ];
            const emailPackages = [
                {
                    id: 'pkg-toner',
                    packageName: 'HP 206A printer toner cartridge',
                    latestStatus: 'ordered',
                    latestStatusLabel: 'Ordered',
                    latestAt: '2026-04-10T15:00:00.000Z',
                    carrier: 'Amazon',
                    updates: []
                },
                {
                    id: 'pkg-unmatched',
                    packageName: 'Palm Sunday crosses',
                    latestStatus: 'shipped',
                    latestStatusLabel: 'Shipped',
                    latestAt: '2026-04-10T17:00:00.000Z',
                    carrier: 'UPS',
                    updates: []
                }
            ];

            const linked = linkManualOrdersToEmailPackages({ items, emailPackages });
            assert.equal(linked.itemMatchesById['orditem-toner']?.emailId, 'pkg-toner');
            assert.equal(Boolean(linked.itemMatchesById['orditem-candles']), false);
        }
    },
    {
        name: 'Orders snapshot separates requests, tracked orders, deliveries, and returns',
        run: async () => {
            const items = [
                normalizeOrderItemRecord({
                    id: 'orditem-needed',
                    title: 'Printer toner',
                    requested_by: 'Office',
                    needed_by: '2026-04-12',
                    status: 'needed'
                }),
                normalizeOrderItemRecord({
                    id: 'orditem-return',
                    title: 'LED floodlight',
                    requested_by: 'Buildings',
                    needed_by: '2026-04-09',
                    status: 'return_pending'
                })
            ];
            const emailPackages = [
                {
                    id: 'pkg-unmatched-ordered',
                    packageName: 'Palm Sunday crosses',
                    latestStatus: 'ordered',
                    latestStatusLabel: 'Ordered',
                    latestAt: '2026-04-10T15:00:00.000Z',
                    carrier: 'Amazon',
                    updates: []
                },
                {
                    id: 'pkg-unmatched-shipped',
                    packageName: 'Kitchen gloves bulk pack',
                    latestStatus: 'shipped',
                    latestStatusLabel: 'Shipped',
                    latestAt: '2026-04-10T17:00:00.000Z',
                    carrier: 'UPS',
                    updates: []
                }
            ];

            const snapshot = buildOrdersSnapshot({ items, emailPackages });
            assert.equal(snapshot.summary.requested, 1);
            assert.equal(snapshot.summary.orders, 1);
            assert.equal(snapshot.summary.deliveries, 1);
            assert.equal(snapshot.summary.returns, 1);
            assert.equal(snapshot.sections.requests[0].item.id, 'orditem-needed');
            assert.equal(snapshot.sections.orders[0].source, 'email');
            assert.equal(snapshot.sections.deliveries[0].tracking.id, 'pkg-unmatched-shipped');
            assert.equal(snapshot.sections.returns[0].item.id, 'orditem-return');
        }
    },
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
        name: 'AP vendor extractor prefers Amazon sender over incidental Staples token',
        run: async () => {
            const sample = [
                'From: Amazon Orders <auto-confirm@amazon.com>',
                'Subject: Your order invoice',
                'Thank you for your order.',
                'Staples heavy duty staples were included in item details.',
                'Amazon order #113-1234567-1234567'
            ].join('\n');
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, 'Amazon');
        }
    },
    {
        name: 'AP vendor extractor returns no vendor for ambiguous peer signals',
        run: async () => {
            const sample = [
                'Subject: Invoice notice',
                'amazon order update',
                'staples order update'
            ].join('\n');
            const result = AP_VENDOR_TEST.extractVendorFromPdfText(sample);
            assert.equal(result.vendor, '');
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
        );

        CREATE TABLE IF NOT EXISTS task_progress_history (
            id TEXT PRIMARY KEY,
            task_instance_id TEXT NOT NULL,
            task_id TEXT,
            title TEXT,
            action TEXT NOT NULL,
            source TEXT NOT NULL,
            actor TEXT,
            from_state TEXT,
            to_state TEXT,
            from_progress_key TEXT,
            to_progress_key TEXT,
            from_completed_at TEXT,
            to_completed_at TEXT,
            changed_fields_json TEXT,
            before_json TEXT,
            after_json TEXT,
            created_at TEXT NOT NULL
        )
    `);
    const columns = db.prepare('PRAGMA table_info(people)').all().map((row) => row.name);
    if (!columns.includes('tags')) {
        db.exec('ALTER TABLE people ADD COLUMN tags TEXT');
    }
    db.prepare('DELETE FROM task_progress_history WHERE task_instance_id LIKE ?').run(`${TEST_TASK_HISTORY_PREFIX}%`);
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
