CREATE TABLE IF NOT EXISTS hgk_supply_requests (
    id TEXT PRIMARY KEY,
    month TEXT UNIQUE NOT NULL,
    notes TEXT,
    occurrence_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (occurrence_id) REFERENCES event_occurrences(id)
);
