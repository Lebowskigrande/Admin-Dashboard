CREATE TABLE IF NOT EXISTS vestry_workflow (
    meeting_date TEXT PRIMARY KEY,
    agenda_status TEXT NOT NULL DEFAULT 'not_started',
    packet_status TEXT NOT NULL DEFAULT 'not_started',
    agenda_ref TEXT,
    packet_ref TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL
);
