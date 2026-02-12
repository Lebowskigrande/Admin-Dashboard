CREATE TABLE IF NOT EXISTS sharefile_jobs (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    thread_id TEXT,
    code_type TEXT,
    code_value TEXT,
    output_json TEXT,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sharefile_jobs_unique
    ON sharefile_jobs (message_id, code_type, code_value);
