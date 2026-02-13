import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';

export const CONFIRM_RESTORE_PHRASE = 'RESTORE DATABASE';
export const CONFIRM_RESTART_PHRASE = 'RESTART SERVICES';
export const CONFIRM_ROUTE_ALL_PHRASE = 'ROUTE SHAREFILE NOW';

export const hasRequiredConfirmation = (value, phrase) => {
    return String(value || '').trim().toUpperCase() === String(phrase || '').trim().toUpperCase();
};

const getIp = (req) => {
    if (!req) return '';
    const xff = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return xff || String(req.ip || req.connection?.remoteAddress || '');
};

export const recordAdminAction = ({
    req = null,
    action = '',
    target = '',
    status = 'success',
    errorText = '',
    details = {}
} = {}) => {
    try {
        const now = new Date().toISOString();
        const id = `admin-action-${randomUUID()}`;
        const userId = req?.user?.id || 'anonymous';
        const ip = getIp(req);
        db.prepare(`
            INSERT INTO admin_action_logs (
                id, user_id, action, target, status, error_text, details_json, ip_address, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            String(userId || 'anonymous'),
            String(action || 'unknown'),
            String(target || ''),
            String(status || 'success'),
            String(errorText || ''),
            JSON.stringify(details || {}),
            ip,
            now
        );
        return { id, createdAt: now };
    } catch (error) {
        console.warn('Failed to record admin action:', error?.message || error);
        return null;
    }
};

export const listRecentAdminActions = (limit = 25) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
    return db.prepare(`
        SELECT id, user_id, action, target, status, error_text, details_json, ip_address, created_at
        FROM admin_action_logs
        ORDER BY created_at DESC
        LIMIT ?
    `).all(safeLimit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        action: row.action,
        target: row.target,
        status: row.status,
        errorText: row.error_text || '',
        details: row.details_json ? JSON.parse(row.details_json) : {},
        ipAddress: row.ip_address || '',
        createdAt: row.created_at
    }));
};

export const __TEST__ = {
    hasRequiredConfirmation
};
