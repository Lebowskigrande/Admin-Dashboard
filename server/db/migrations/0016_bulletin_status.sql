CREATE TABLE IF NOT EXISTS bulletin_status (
    date TEXT NOT NULL,
    doc_key TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, doc_key)
);
