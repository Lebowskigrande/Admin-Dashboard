-- Polymorphic link backfill + task priority extensions

ALTER TABLE task_instances ADD COLUMN sla_target_at TEXT;
--> statement-breakpoint
ALTER TABLE task_instances ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_priority_policy (
    id TEXT PRIMARY KEY,
    task_type TEXT UNIQUE,
    default_priority_base INTEGER,
    overdue_boost INTEGER,
    due_today_boost INTEGER,
    due_soon_boost INTEGER,
    no_due_boost INTEGER
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ticket_areas (
    ticket_id TEXT NOT NULL,
    area_id TEXT NOT NULL,
    UNIQUE(ticket_id, area_id)
);
--> statement-breakpoint

INSERT OR IGNORE INTO entity_links (
    id,
    from_type,
    from_id,
    to_type,
    to_id,
    role,
    created_at,
    meta_json
)
SELECT
    'link-ticket-area-' || ticket_id || '-' || area_id,
    'ticket',
    ticket_id,
    'area',
    area_id,
    'location',
    COALESCE(t.created_at, datetime('now')),
    NULL
FROM ticket_areas ta
LEFT JOIN tickets t ON t.id = ta.ticket_id;
