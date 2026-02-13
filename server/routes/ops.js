import express from 'express';
import { resolve } from 'path';
import { sqlite as db } from '../db.js';
import { validateRuntimeConfig } from '../config/runtimeConfig.js';
import { listRecentAdminActions } from '../helpers/adminAudit.js';

const router = express.Router();

const safeStatRow = (query, ...params) => {
    try {
        return db.prepare(query).get(...params) || null;
    } catch {
        return null;
    }
};

router.get('/api/ops/status', (req, res) => {
    const strict = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const config = validateRuntimeConfig(process.env, { strict });
    const nowIso = new Date().toISOString();

    const googleCountRow = safeStatRow(`SELECT count(*) AS count FROM events WHERE source = 'google'`);
    const googleLastRow = safeStatRow(`SELECT max(updated_at) AS last_updated FROM events WHERE source = 'google'`);
    const sharefileLastSuccessRow = safeStatRow(`
        SELECT created_at AS ts
        FROM sharefile_job_events
        WHERE status = 'success'
        ORDER BY created_at DESC
        LIMIT 1
    `);
    const sharefileLastFailureRow = safeStatRow(`
        SELECT created_at AS ts, error_text
        FROM sharefile_job_events
        WHERE status = 'failure'
        ORDER BY created_at DESC
        LIMIT 1
    `);
    const sharefileEventCountRow = safeStatRow(`SELECT count(*) AS count FROM sharefile_job_events`);
    const latestBackupRow = safeStatRow(`
        SELECT action, status, created_at
        FROM admin_action_logs
        WHERE action IN ('db.backup', 'db.restore')
        ORDER BY created_at DESC
        LIMIT 1
    `);
    const ccTokensRow = safeStatRow(`SELECT count(*) AS count FROM constant_contact_tokens`);
    const googleTokensRow = safeStatRow(`SELECT count(*) AS count FROM user_tokens`);

    const sharefileBasesRaw = String(process.env.SHAREFILE_ROUTER_BASES || '').trim();
    let sharefileBasesConfigured = false;
    if (sharefileBasesRaw) {
        try {
            const parsed = JSON.parse(sharefileBasesRaw);
            sharefileBasesConfigured = !!(parsed?.budget || parsed?.envelope);
        } catch {
            sharefileBasesConfigured = /"budget"\s*:|"envelope"\s*:/i.test(sharefileBasesRaw);
        }
    }

    const dbBackupDir = String(process.env.DB_BACKUP_DIR || '').trim();
    const backupDirResolved = dbBackupDir ? resolve(dbBackupDir) : '';

    const payload = {
        ok: config.ok,
        now: nowIso,
        uptimeSeconds: Math.floor(process.uptime()),
        config,
        services: {
            google: {
                ready: config.services.google.ready,
                connectedAccounts: Number(googleTokensRow?.count || 0)
            },
            sharefile: {
                ready: config.services.sharefile.ready,
                pollerEnabled: String(process.env.SHAREFILE_ROUTER_ENABLED || '0') === '1',
                pollIntervalMs: Number(process.env.SHAREFILE_ROUTER_INTERVAL_MS || 300000),
                basesConfigured: sharefileBasesConfigured
            },
            constantContact: {
                ready: config.services.constantContact.ready,
                connectedAccounts: Number(ccTokensRow?.count || 0)
            },
            backups: {
                backupDir: backupDirResolved || null,
                latestAdminBackupAction: latestBackupRow
                    ? {
                        action: latestBackupRow.action,
                        status: latestBackupRow.status,
                        createdAt: latestBackupRow.created_at
                    }
                    : null
            }
        },
        sync: {
            googleEvents: {
                count: Number(googleCountRow?.count || 0),
                lastUpdatedAt: googleLastRow?.last_updated || null
            },
            sharefileRouting: {
                eventCount: Number(sharefileEventCountRow?.count || 0),
                lastSuccessAt: sharefileLastSuccessRow?.ts || null,
                lastFailureAt: sharefileLastFailureRow?.ts || null,
                lastFailureError: sharefileLastFailureRow?.error_text || ''
            }
        },
        adminActions: listRecentAdminActions(20)
    };

    res.json(payload);
});

export default router;
