const get = (name) => String(process.env[name] || '').trim();
const has = (name) => get(name).length > 0;

const ensureAllOrNone = (errors, names, context) => {
    const present = names.filter((name) => has(name));
    if (present.length > 0 && present.length < names.length) {
        const missing = names.filter((name) => !has(name));
        errors.push(`[${context}] missing required env vars: ${missing.join(', ')}`);
    }
};

const ensurePair = (errors, primary, required, context) => {
    if (has(primary) && !has(required)) {
        errors.push(`[${context}] ${required} is required when ${primary} is set`);
    }
};

export const validateStartupEnv = () => {
    const errors = [];

    if (has('SERVER_PORT') && !/^\d+$/.test(get('SERVER_PORT'))) {
        errors.push('[core] SERVER_PORT must be a valid integer');
    }

    if (process.env.NODE_ENV === 'production') {
        if (!has('CLIENT_ORIGIN')) {
            errors.push('[core] CLIENT_ORIGIN is required in production');
        }
    }

    ensureAllOrNone(
        errors,
        ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
        'google-oauth'
    );

    ensureAllOrNone(
        errors,
        ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REDIRECT_URI'],
        'dropbox-oauth'
    );
    ensurePair(errors, 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'dropbox-oauth');
    ensurePair(errors, 'DROPBOX_APP_SECRET', 'DROPBOX_APP_KEY', 'dropbox-oauth');

    ensureAllOrNone(
        errors,
        ['CC_CLIENT_ID', 'CC_CLIENT_SECRET', 'CC_REDIRECT_URI'],
        'constant-contact-oauth'
    );

    if (has('SHAREFILE_GOOGLE_REDIRECT_URI')) {
        ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].forEach((name) => {
            if (!has(name)) {
                errors.push(`[sharefile-google] ${name} is required when SHAREFILE_GOOGLE_REDIRECT_URI is set`);
            }
        });
    }

    if (has('YOUTUBE_API_KEY') !== has('YOUTUBE_CHANNEL_ID')) {
        errors.push('[youtube] YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID must be configured together');
    }

    if (errors.length > 0) {
        const details = errors.map((entry) => ` - ${entry}`).join('\n');
        const error = new Error(`Environment validation failed:\n${details}`);
        error.name = 'StartupEnvValidationError';
        throw error;
    }
};
