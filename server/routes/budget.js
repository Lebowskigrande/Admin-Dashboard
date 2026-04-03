import express from 'express';
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';

import { sqlite } from '../db.js';
import { requireAdmin } from '../helpers/auth.js';
import {
    DEFAULT_BUDGET_REPORT_PATH,
    buildCodeBucketMap,
    collectBudgetTransactionsFromJobs,
    loadBudgetCodes,
    mapBudgetEntriesToBuckets,
    parseBudgetSnapshotReport,
    scanBudgetSourceFolders
} from '../helpers/budget-utils.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

const escapePowerShellSingleQuoted = (value) => String(value || '').replace(/'/g, "''");

const listBudgetSources = () => sqlite.prepare(`
    SELECT id, label, folder_path, enabled, created_at, updated_at
    FROM budget_scan_sources
    ORDER BY enabled DESC, label COLLATE NOCASE ASC, created_at ASC
`).all().map((row) => ({
    id: row.id,
    label: String(row.label || '').trim(),
    path: String(row.folder_path || '').trim(),
    enabled: Number(row.enabled || 0) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
}));

const saveBudgetSource = ({ label = '', path = '' } = {}) => {
    const now = new Date().toISOString();
    const normalizedPath = String(path || '').trim();
    const normalizedLabel = String(label || '').trim() || basename(normalizedPath) || normalizedPath;
    const existing = sqlite.prepare(`
        SELECT id FROM budget_scan_sources WHERE folder_path = ? LIMIT 1
    `).get(normalizedPath);
    if (existing?.id) {
        sqlite.prepare(`
            UPDATE budget_scan_sources
            SET label = ?, enabled = 1, updated_at = ?
            WHERE id = ?
        `).run(normalizedLabel, now, existing.id);
        return existing.id;
    }
    const id = `budget-source-${randomUUID()}`;
    sqlite.prepare(`
        INSERT INTO budget_scan_sources (id, label, folder_path, enabled, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
    `).run(id, normalizedLabel, normalizedPath, now, now);
    return id;
};

const pickFolderPath = async ({ description = 'Select budget transaction folder' } = {}) => {
    const safeDescription = escapePowerShellSingleQuoted(description);
    const script = `
Add-Type -AssemblyName System.Windows.Forms;
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;
$dialog.Description = '${safeDescription}';
$dialog.ShowNewFolderButton = $true;
$result = $dialog.ShowDialog();
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath };
`;
    const result = await execFileAsync('powershell', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    return String(result?.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop() || '';
};

const buildBudgetOverview = async () => {
    const snapshot = await parseBudgetSnapshotReport(DEFAULT_BUDGET_REPORT_PATH);
    const budgetEntries = mapBudgetEntriesToBuckets(
        loadBudgetCodes().filter((entry) => String(entry?.type || '').toLowerCase() === 'item'),
        snapshot
    );
    const codeBucketMap = buildCodeBucketMap(budgetEntries);
    const trackedBucketLabels = new Set(
        budgetEntries
            .map((entry) => String(entry?.bucketLabel || '').trim())
            .filter(Boolean)
    );
    const configuredSources = listBudgetSources();

    const budgetJobRows = sqlite.prepare(`
        SELECT id, code_value, output_json, created_at
        FROM sharefile_jobs
        WHERE code_type = 'budget'
          AND created_at >= ?
        ORDER BY created_at DESC
    `).all(`${snapshot.reportYear || new Date().getFullYear()}-01-01T00:00:00.000Z`);

    const seenPaths = new Set();
    const { transactions: directTransactions, discoveredFolders } = await collectBudgetTransactionsFromJobs({
        rows: budgetJobRows,
        codeBucketMap,
        snapshotDate: snapshot.statementDate,
        seenPaths
    });

    const folderTransactions = await scanBudgetSourceFolders({
        sources: [...discoveredFolders, ...configuredSources.filter((source) => source.enabled)],
        codeBucketMap,
        snapshotDate: snapshot.statementDate,
        seenPaths,
        reportYear: snapshot.reportYear
    });

    const allTransactions = [...directTransactions, ...folderTransactions]
        .sort((a, b) => String(b.dateIso || '').localeCompare(String(a.dateIso || '')));

    const bucketStats = new Map(
        (snapshot.lines || [])
            .filter((line) => trackedBucketLabels.has(String(line?.label || '').trim()))
            .map((line) => [line.label, {
                ...line,
                postSnapshotActual: 0,
                parsedTransactionCount: 0,
                unresolvedTransactionCount: 0
            }])
    );

    const codeActuals = new Map();
    allTransactions.forEach((transaction) => {
        const code = String(transaction.code || '').trim();
        if (code) {
            if (!codeActuals.has(code)) codeActuals.set(code, { actual: 0, transactionCount: 0 });
            const codeEntry = codeActuals.get(code);
            if (Number.isFinite(transaction.amount)) codeEntry.actual += transaction.amount;
            codeEntry.transactionCount += 1;
        }

        const bucket = bucketStats.get(transaction.bucketLabel);
        if (!bucket) return;
        if (Number.isFinite(transaction.amount)) {
            if (!transaction.includedInSnapshot) {
                bucket.postSnapshotActual += transaction.amount;
            }
            bucket.parsedTransactionCount += 1;
        } else {
            bucket.unresolvedTransactionCount += 1;
        }
    });

    const buckets = Array.from(bucketStats.values())
        .map((bucket) => {
            const currentActual = (Number.isFinite(bucket.actualYtd) ? bucket.actualYtd : 0) + bucket.postSnapshotActual;
            const annualBudget = Number.isFinite(bucket.annualBudget) ? bucket.annualBudget : null;
            const progressRatio = annualBudget && annualBudget > 0 ? currentActual / annualBudget : null;
            return {
                ...bucket,
                currentActual,
                annualBudget,
                progressRatio,
                variance: annualBudget != null ? annualBudget - currentActual : null
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    const bucketByLabel = new Map(buckets.map((bucket) => [bucket.label, bucket]));
    const apEntries = budgetEntries
        .map((entry) => {
            const bucket = entry.bucketLabel ? bucketByLabel.get(entry.bucketLabel) : null;
            const codeActual = codeActuals.get(String(entry.code || '').trim()) || { actual: 0, transactionCount: 0 };
            return {
                ...entry,
                annualBudget: bucket?.annualBudget ?? null,
                actualYtd: bucket?.actualYtd ?? null,
                currentActual: bucket?.currentActual ?? null,
                variance: bucket?.variance ?? null,
                progressRatio: bucket?.progressRatio ?? null,
                bucketParsedTransactionCount: bucket?.parsedTransactionCount ?? 0,
                bucketUnresolvedTransactionCount: bucket?.unresolvedTransactionCount ?? 0,
                codeTransactionActual: codeActual.actual,
                codeTransactionCount: codeActual.transactionCount
            };
        })
        .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));

    const summary = buckets.reduce((acc, bucket) => {
        if (bucket.isTotal) return acc;
        if (Number.isFinite(bucket.annualBudget)) acc.annualBudget += bucket.annualBudget;
        if (Number.isFinite(bucket.currentActual)) acc.currentActual += bucket.currentActual;
        if ((bucket.progressRatio || 0) > 1) acc.overBudgetCount += 1;
        acc.unresolvedTransactions += Number(bucket.unresolvedTransactionCount || 0);
        return acc;
    }, {
        annualBudget: 0,
        currentActual: 0,
        overBudgetCount: 0,
        unresolvedTransactions: 0
    });

    return {
        snapshot,
        summary,
        entries: apEntries,
        buckets,
        transactions: allTransactions.slice(0, 400),
        sources: {
            configured: configuredSources,
            discovered: discoveredFolders
        }
    };
};

router.use(requireAdmin);

router.get('/overview', async (_req, res) => {
    try {
        const overview = await buildBudgetOverview();
        res.json({ ok: true, ...overview });
    } catch (error) {
        console.error('Budget overview error:', error);
        res.status(500).json({ ok: false, error: error?.message || 'Failed to build budget overview' });
    }
});

router.post('/sources/pick-folder', async (_req, res) => {
    try {
        const folderPath = await pickFolderPath();
        res.json({ ok: true, path: folderPath || '' });
    } catch (error) {
        console.error('Budget folder picker error:', error);
        res.status(500).json({ ok: false, error: 'Failed to open folder picker' });
    }
});

router.post('/sources', async (req, res) => {
    try {
        const path = String(req.body?.path || '').trim();
        const label = String(req.body?.label || '').trim();
        if (!path) {
            return res.status(400).json({ ok: false, error: 'path is required' });
        }
        const id = saveBudgetSource({ label, path });
        return res.json({ ok: true, id });
    } catch (error) {
        console.error('Budget source save error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to save budget source' });
    }
});

router.patch('/sources/:id', async (req, res) => {
    try {
        const id = String(req.params?.id || '').trim();
        if (!id) {
            return res.status(400).json({ ok: false, error: 'id is required' });
        }
        const existing = sqlite.prepare(`
            SELECT id, label, folder_path, enabled
            FROM budget_scan_sources
            WHERE id = ?
            LIMIT 1
        `).get(id);
        if (!existing) {
            return res.status(404).json({ ok: false, error: 'Budget source not found' });
        }
        const now = new Date().toISOString();
        const enabled = req.body?.enabled === undefined
            ? Number(existing.enabled || 0) === 1
            : Boolean(req.body.enabled);
        const label = String(req.body?.label || existing.label || '').trim() || basename(String(existing.folder_path || '').trim());
        sqlite.prepare(`
            UPDATE budget_scan_sources
            SET label = ?, enabled = ?, updated_at = ?
            WHERE id = ?
        `).run(label, enabled ? 1 : 0, now, id);
        return res.json({ ok: true });
    } catch (error) {
        console.error('Budget source update error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to update budget source' });
    }
});

router.delete('/sources/:id', async (req, res) => {
    try {
        const id = String(req.params?.id || '').trim();
        sqlite.prepare('DELETE FROM budget_scan_sources WHERE id = ?').run(id);
        return res.json({ ok: true });
    } catch (error) {
        console.error('Budget source delete error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to remove budget source' });
    }
});

export default router;
