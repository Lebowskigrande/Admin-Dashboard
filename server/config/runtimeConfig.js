import { isAbsolute, resolve } from 'path';
import { accessSync, constants } from 'fs';

const REQUIRED_PROD_VARS = [
    'CLIENT_ORIGIN',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'CC_CLIENT_ID',
    'CC_CLIENT_SECRET',
    'CC_REDIRECT_URI'
];

const toTrimmed = (value) => String(value || '').trim();

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const canAccessPath = (value) => {
    try {
        accessSync(value, constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

const parseSharefileRouterBases = (rawValue) => {
    const raw = toTrimmed(rawValue);
    if (!raw) return { bases: {}, parseError: '' };

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { bases: {}, parseError: 'SHAREFILE_ROUTER_BASES must be a JSON object.' };
        }
        return { bases: parsed, parseError: '' };
    } catch {
        const extracted = {};
        const pattern = /"(budget|envelope)"\s*:\s*"([^"]*)"/gi;
        let match = pattern.exec(raw);
        while (match) {
            const key = String(match[1] || '').toLowerCase();
            const value = toTrimmed(match[2]);
            if (key && value) extracted[key] = value;
            match = pattern.exec(raw);
        }
        if (Object.keys(extracted).length > 0) {
            return { bases: extracted, parseError: '' };
        }
        return {
            bases: {},
            parseError: 'SHAREFILE_ROUTER_BASES is not valid JSON. Use {"budget":"C:\\\\path","envelope":"C:\\\\path"}.'
        };
    }
};

const validateUrl = (key, value, checks, errors) => {
    const normalized = toTrimmed(value);
    if (!normalized) return;
    try {
        const parsed = new URL(normalized);
        const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        if (!isHttp) {
            errors.push(`${key} must be an http(s) URL. Received: ${normalized}`);
            return;
        }
        checks[key] = normalized;
    } catch {
        errors.push(`${key} is not a valid URL: ${normalized}`);
    }
};

const validateAbsolutePath = (key, value, checks, errors, warnings, { mustExist = false } = {}) => {
    const normalized = toTrimmed(value);
    if (!normalized) return;
    const resolved = resolve(normalized);
    if (!isAbsolute(resolved)) {
        errors.push(`${key} must be an absolute path. Received: ${normalized}`);
        return;
    }
    if (mustExist && !canAccessPath(resolved)) {
        warnings.push(`${key} does not exist yet: ${resolved}`);
    }
    checks[key] = resolved;
};

export const validateRuntimeConfig = (env = process.env, { strict = false } = {}) => {
    const errors = [];
    const warnings = [];
    const checks = {};
    const mode = toTrimmed(env.NODE_ENV) || 'development';

    REQUIRED_PROD_VARS.forEach((key) => {
        const value = toTrimmed(env[key]);
        if (!value) {
            if (strict) {
                errors.push(`Missing required environment variable: ${key}`);
            } else {
                warnings.push(`Missing recommended environment variable: ${key}`);
            }
        } else {
            checks[key] = value;
        }
    });

    const sharefileRedirect = toTrimmed(env.SHAREFILE_GOOGLE_REDIRECT_URI);
    const googleRedirect = toTrimmed(env.GOOGLE_REDIRECT_URI);
    if (!sharefileRedirect && googleRedirect) {
        checks.SHAREFILE_GOOGLE_REDIRECT_URI = googleRedirect.replace('/auth/google/callback', '/auth/google/sharefile/callback');
    } else if (sharefileRedirect) {
        checks.SHAREFILE_GOOGLE_REDIRECT_URI = sharefileRedirect;
    } else if (strict) {
        errors.push('Missing SHAREFILE_GOOGLE_REDIRECT_URI (or GOOGLE_REDIRECT_URI fallback).');
    } else {
        warnings.push('Missing SHAREFILE_GOOGLE_REDIRECT_URI (and no GOOGLE_REDIRECT_URI fallback).');
    }

    validateUrl('CLIENT_ORIGIN', env.CLIENT_ORIGIN, checks, errors);
    validateUrl('GOOGLE_REDIRECT_URI', googleRedirect, checks, errors);
    validateUrl('SHAREFILE_GOOGLE_REDIRECT_URI', checks.SHAREFILE_GOOGLE_REDIRECT_URI, checks, errors);
    validateUrl('CC_REDIRECT_URI', env.CC_REDIRECT_URI, checks, errors);

    const ccFromEmail = toTrimmed(env.CC_FROM_EMAIL);
    if (ccFromEmail && !looksLikeEmail(ccFromEmail)) {
        errors.push(`CC_FROM_EMAIL is not a valid email address: ${ccFromEmail}`);
    } else if (ccFromEmail) {
        checks.CC_FROM_EMAIL = ccFromEmail;
    }
    const ccReplyTo = toTrimmed(env.CC_REPLY_TO_EMAIL);
    if (ccReplyTo && !looksLikeEmail(ccReplyTo)) {
        errors.push(`CC_REPLY_TO_EMAIL is not a valid email address: ${ccReplyTo}`);
    } else if (ccReplyTo) {
        checks.CC_REPLY_TO_EMAIL = ccReplyTo;
    }

    validateAbsolutePath('DB_BACKUP_DIR', env.DB_BACKUP_DIR, checks, errors, warnings, { mustExist: true });
    validateAbsolutePath('DROPBOX_ROOT', env.DROPBOX_ROOT, checks, errors, warnings, { mustExist: true });
    validateAbsolutePath('SOFFICE_PATH', env.SOFFICE_PATH, checks, errors, warnings, { mustExist: true });

    const routerEnabled = String(env.SHAREFILE_ROUTER_ENABLED || '0') === '1';
    checks.SHAREFILE_ROUTER_ENABLED = routerEnabled ? '1' : '0';
    if (routerEnabled) {
        const interval = Number(env.SHAREFILE_ROUTER_INTERVAL_MS);
        if (!Number.isFinite(interval) || interval < 10_000) {
            warnings.push('SHAREFILE_ROUTER_INTERVAL_MS should be >= 10000 when SHAREFILE_ROUTER_ENABLED=1.');
        } else {
            checks.SHAREFILE_ROUTER_INTERVAL_MS = String(interval);
        }
    }

    const sharefileBasesResult = parseSharefileRouterBases(env.SHAREFILE_ROUTER_BASES);
    if (sharefileBasesResult.parseError) {
        errors.push(sharefileBasesResult.parseError);
    }
    const sharefileBases = sharefileBasesResult.bases;
    ['budget', 'envelope'].forEach((key) => {
        const value = toTrimmed(sharefileBases[key]);
        if (!value) return;
        const resolved = resolve(value);
        if (!isAbsolute(resolved)) {
            errors.push(`SHAREFILE_ROUTER_BASES.${key} must be an absolute path. Received: ${value}`);
            return;
        }
        checks[`SHAREFILE_ROUTER_BASES.${key}`] = resolved;
        if (!canAccessPath(resolved)) {
            warnings.push(`ShareFile ${key} folder is not currently reachable: ${resolved}`);
        }
    });

    const services = {
        google: {
            ready: !!toTrimmed(env.GOOGLE_CLIENT_ID) && !!toTrimmed(env.GOOGLE_CLIENT_SECRET) && !!googleRedirect
        },
        sharefile: {
            ready: !!checks.SHAREFILE_GOOGLE_REDIRECT_URI
        },
        constantContact: {
            ready: !!toTrimmed(env.CC_CLIENT_ID) && !!toTrimmed(env.CC_CLIENT_SECRET) && !!toTrimmed(env.CC_REDIRECT_URI)
        }
    };

    return {
        ok: errors.length === 0,
        strict,
        mode,
        errors,
        warnings,
        checks,
        services
    };
};

export const assertRuntimeConfig = (env = process.env) => {
    const strict = String(env.NODE_ENV || '').toLowerCase() === 'production';
    const result = validateRuntimeConfig(env, { strict });
    if (result.errors.length > 0) {
        const body = result.errors.map((item) => ` - ${item}`).join('\n');
        const message = `Configuration validation failed:\n${body}`;
        throw new Error(message);
    }
    return result;
};

export const __TEST__ = {
    parseSharefileRouterBases,
    looksLikeEmail
};
