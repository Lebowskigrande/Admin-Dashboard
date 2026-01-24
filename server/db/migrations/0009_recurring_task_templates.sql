-- Recurring task templates (origin rollups)

CREATE TABLE IF NOT EXISTS recurring_task_templates (
    id TEXT PRIMARY KEY,
    origin_type TEXT NOT NULL,
    origin_id TEXT,
    step_key TEXT NOT NULL,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    due_offset_days INTEGER,
    priority_base INTEGER NOT NULL DEFAULT 50,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(origin_type, origin_id, step_key)
);
--> statement-breakpoint

INSERT OR IGNORE INTO recurring_task_templates (
    id,
    origin_type,
    origin_id,
    step_key,
    title,
    sort_order,
    due_offset_days,
    priority_base,
    active,
    created_at,
    updated_at
)
VALUES
    ('tmpl-bulletin-readings', 'sunday', NULL, 'collect-readings', 'Collect scripture readings', 10, -10, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-hymns', 'sunday', NULL, 'select-hymns', 'Select hymns with Music Director', 20, -9, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-draft-8', 'sunday', NULL, 'draft-8am', 'Draft 8am Service', 30, -7, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-draft-10', 'sunday', NULL, 'draft-10am', 'Draft 10am Service', 40, -7, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-inserts', 'sunday', NULL, 'print-inserts', 'Print Inserts', 50, -3, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-fold', 'sunday', NULL, 'print-fold', 'Print & fold Bulletins', 60, -2, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-stuff', 'sunday', NULL, 'stuff-inserts', 'Stuff inserts', 70, -1, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-bulletin-narthex', 'sunday', NULL, 'place-narthex', 'Place in Narthex', 80, 0, 70, 1, datetime('now'), datetime('now'));
