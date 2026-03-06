import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { sqlite } from '../server/db.js';
import { createApp } from '../server/app.js';

const toDateKey = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const safeJson = (value) => {
    try {
        return JSON.parse(value || '{}');
    } catch {
        return {};
    }
};

const run = async () => {
    const now = new Date().toISOString();
    const stamp = `${Date.now()}`;
    const jobId = `qa-job-${stamp}`;
    const eventId = `qa-event-${stamp}`;
    const attemptId = `qa-attempt-${stamp}`;
    const tempDir = await mkdtemp(join(tmpdir(), 'qa-routing-refactor-'));
    const fileA = join(tempDir, 'qa-a.pdf');
    const fileB = join(tempDir, 'qa-b.pdf');
    await writeFile(fileA, Buffer.from('%PDF-1.4\n%qa-a\n'));
    await writeFile(fileB, Buffer.from('%PDF-1.4\n%qa-b\n'));

    const initialOutput = {
        targetDir: tempDir,
        files: [
            { name: 'qa-a.pdf', path: fileA },
            { name: 'qa-b.pdf', path: fileB }
        ],
        routing: {
            routeKind: 'BILL',
            vendor: 'QA Vendor One',
            history: []
        }
    };

    sqlite.prepare(`
        INSERT INTO sharefile_jobs (id, message_id, thread_id, code_type, code_value, output_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        jobId,
        `qa-message-${stamp}`,
        `qa-thread-${stamp}`,
        'budget',
        'QA-CODE-1',
        JSON.stringify(initialOutput),
        now
    );

    sqlite.prepare(`
        INSERT INTO sharefile_job_events (
            id, attempt_id, job_id, message_id, thread_id, code_type, code_value, status, error_text, output_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        eventId,
        attemptId,
        jobId,
        `qa-message-${stamp}`,
        `qa-thread-${stamp}`,
        'budget',
        'QA-CODE-1',
        'success',
        '',
        JSON.stringify(initialOutput),
        now
    );

    sqlite.prepare(`
        INSERT INTO routing_attempts (
            id, job_id, message_id, thread_id, code_type, code_value, source, status, error_text, output_json,
            written_files_json, started_at, completed_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        attemptId,
        jobId,
        `qa-message-${stamp}`,
        `qa-thread-${stamp}`,
        'budget',
        'QA-CODE-1',
        'qa-harness',
        'success',
        '',
        JSON.stringify(initialOutput),
        JSON.stringify([fileA, fileB]),
        now,
        now,
        now,
        now
    );

    const app = createApp({ clientOrigin: 'http://localhost:5173' });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api/deposit-slip`;
    const report = {
        dateKey: toDateKey(),
        routeSeeded: true,
        initialJobId: jobId,
        checks: []
    };

    try {
        const initialLogRes = await fetch(`${base}/routing-log?type=ap&date=${encodeURIComponent(report.dateKey)}`);
        const initialLog = await initialLogRes.json();
        const initialEntry = (initialLog.entries || []).find((entry) => String(entry.jobId || '') === jobId);
        report.checks.push({
            step: 'initial-log',
            ok: Boolean(initialEntry),
            details: initialEntry ? `Found seeded job ${jobId}` : 'Seeded job not found in routing log'
        });

        const reroute1Res = await fetch(`${base}/routing-log/ap-entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId,
                codeValue: 'QA-CODE-2',
                vendor: 'QA Vendor Two',
                files: [
                    { fileIndex: 0, name: 'qa-a-renamed.pdf', path: fileA, deleted: false },
                    { fileIndex: 1, name: 'qa-b.pdf', path: fileB, deleted: true }
                ]
            })
        });
        const reroute1 = await reroute1Res.json();
        report.checks.push({
            step: 'reroute-1',
            ok: Boolean(reroute1Res.ok && reroute1.ok),
            details: reroute1Res.ok ? `renamed=${reroute1.renamedFiles || 0}, deleted=${reroute1.deletedFiles || 0}` : (reroute1.error || 'failed')
        });

        const revealRes = await fetch(`${base}/routing-log/reveal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, fileIndex: 0 })
        });
        const reveal = await revealRes.json().catch(() => ({}));
        const revealDetail = String(reveal.warning || reveal.error || '').trim();
        const revealSandboxExpected = /unable to open file location/i.test(revealDetail);
        report.checks.push({
            step: 'reveal',
            ok: Boolean((revealRes.ok && reveal.ok) || revealSandboxExpected),
            details: revealSandboxExpected
                ? `${revealDetail} (expected in non-GUI sandbox)`
                : (reveal.warning || reveal.error || 'no message')
        });

        const currentOutputRow = sqlite.prepare('SELECT code_value, output_json FROM sharefile_jobs WHERE id = ?').get(jobId);
        const currentOutput = safeJson(currentOutputRow?.output_json);
        const currentFiles = Array.isArray(currentOutput.files) ? currentOutput.files : [];
        const firstFilePath = String(currentFiles[0]?.path || '').trim();

        const reroute2Res = await fetch(`${base}/routing-log/ap-entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId,
                codeValue: 'QA-CODE-3',
                vendor: 'QA Vendor Three',
                files: [
                    { fileIndex: 0, name: 'qa-final.pdf', path: firstFilePath, deleted: false }
                ]
            })
        });
        const reroute2 = await reroute2Res.json();
        report.checks.push({
            step: 'reroute-2',
            ok: Boolean(reroute2Res.ok && reroute2.ok),
            details: reroute2Res.ok ? `renamed=${reroute2.renamedFiles || 0}, deleted=${reroute2.deletedFiles || 0}` : (reroute2.error || 'failed')
        });

        const finalRow = sqlite.prepare('SELECT code_value, output_json FROM sharefile_jobs WHERE id = ? LIMIT 1').get(jobId);
        const finalOutput = safeJson(finalRow?.output_json);
        const finalHistory = Array.isArray(finalOutput?.routing?.history) ? finalOutput.routing.history : [];
        const apUpdateCount = finalHistory.filter((row) => String(row?.action || '') === 'ap-entry-update').length;

        report.final = {
            codeValue: String(finalRow?.code_value || ''),
            fileCount: Array.isArray(finalOutput?.files) ? finalOutput.files.length : 0,
            historyCount: finalHistory.length,
            apEntryUpdateActions: apUpdateCount
        };
        report.checks.push({
            step: 'db-consistency',
            ok: report.final.codeValue === 'QA-CODE-3' && report.final.fileCount === 1 && apUpdateCount >= 2,
            details: `code=${report.final.codeValue}, files=${report.final.fileCount}, ap-entry-update-actions=${apUpdateCount}`
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        sqlite.prepare('DELETE FROM routing_attempts WHERE id = ?').run(attemptId);
        sqlite.prepare('DELETE FROM sharefile_job_events WHERE id = ?').run(eventId);
        sqlite.prepare('DELETE FROM sharefile_jobs WHERE id = ?').run(jobId);
        await rm(tempDir, { recursive: true, force: true });
    }

    const passCount = report.checks.filter((row) => row.ok).length;
    const failCount = report.checks.length - passCount;
    console.log(JSON.stringify({ summary: { passCount, failCount }, report }, null, 2));
    process.exitCode = failCount > 0 ? 1 : 0;
};

run().catch((error) => {
    console.error('[qa-routing-log-refactor] fatal', error);
    process.exitCode = 1;
});
