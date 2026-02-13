CREATE TABLE IF NOT EXISTS admin_action_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    status TEXT NOT NULL,
    error_text TEXT,
    details_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
);
