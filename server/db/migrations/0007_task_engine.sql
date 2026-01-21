-- Task engine schema + legacy tasks migration
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    ticket_id TEXT,
    text TEXT,
    completed INTEGER,
    created_at TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tasks_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    priority_base INTEGER NOT NULL DEFAULT 50,
    task_type TEXT,
    due_mode TEXT NOT NULL DEFAULT 'floating',
    default_duration_min INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority
    ON tasks_new (status, priority_base);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_tasks_type_status
    ON tasks_new (task_type, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_instances (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'open',
    due_at TEXT,
    start_at TEXT,
    completed_at TEXT,
    generated_from TEXT,
    generation_key TEXT,
    priority_override INTEGER,
    rank INTEGER
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_instances_generation_key
    ON task_instances (generation_key)
    WHERE generation_key IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_instances_state_due
    ON task_instances (state, due_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_instances_task_due
    ON task_instances (task_id, due_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_recurrences (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks_new(id) ON DELETE CASCADE,
    freq TEXT NOT NULL,
    interval INTEGER NOT NULL DEFAULT 1,
    by_weekday_mask INTEGER,
    by_monthday INTEGER,
    by_setpos INTEGER,
    by_weekday INTEGER,
    by_month INTEGER,
    time_of_day TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    next_run_at TEXT,
    last_generated_at TEXT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_recurrences_next_run
    ON task_recurrences (next_run_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_recurrence_exceptions (
    id TEXT PRIMARY KEY,
    task_recurrence_id TEXT NOT NULL REFERENCES task_recurrences(id) ON DELETE CASCADE,
    exception_date TEXT NOT NULL,
    action TEXT NOT NULL,
    override_due_at TEXT,
    note TEXT,
    UNIQUE(task_recurrence_id, exception_date)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_recur_ex_date
    ON task_recurrence_exceptions (exception_date);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS entity_links (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    role TEXT,
    created_at TEXT NOT NULL,
    meta_json TEXT,
    UNIQUE(from_type, from_id, to_type, to_id, role)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_entity_links_from
    ON entity_links (from_type, from_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_entity_links_to
    ON entity_links (to_type, to_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_entity_links_to_role
    ON entity_links (to_type, to_id, role);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_origins (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    task_id TEXT REFERENCES tasks_new(id) ON DELETE CASCADE,
    task_instance_id TEXT REFERENCES task_instances(id) ON DELETE CASCADE,
    origin_type TEXT NOT NULL,
    origin_id TEXT NOT NULL,
    origin_event TEXT,
    created_at TEXT NOT NULL,
    CHECK(
        (scope = 'task' AND task_id IS NOT NULL AND task_instance_id IS NULL)
        OR (scope = 'instance' AND task_instance_id IS NOT NULL)
    ),
    UNIQUE(scope, origin_type, origin_id, origin_event)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_origins_task
    ON task_origins (scope, task_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_origins_instance
    ON task_origins (scope, task_instance_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_origins_origin
    ON task_origins (origin_type, origin_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_tokens (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    task_id TEXT REFERENCES tasks_new(id) ON DELETE CASCADE,
    task_instance_id TEXT REFERENCES task_instances(id) ON DELETE CASCADE,
    token_key TEXT NOT NULL,
    value_text TEXT,
    value_int INTEGER,
    value_real REAL,
    value_bool INTEGER,
    value_date TEXT,
    value_datetime TEXT,
    value_json TEXT,
    source TEXT,
    updated_at TEXT NOT NULL,
    CHECK(
        (scope = 'task' AND task_id IS NOT NULL AND task_instance_id IS NULL)
        OR (scope = 'instance' AND task_instance_id IS NOT NULL)
    )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_tokens_task_key
    ON task_tokens (task_id, token_key)
    WHERE scope = 'task';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_tokens_instance_key
    ON task_tokens (task_instance_id, token_key)
    WHERE scope = 'instance';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_tokens_task
    ON task_tokens (task_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_tokens_instance
    ON task_tokens (task_instance_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_task_tokens_key
    ON task_tokens (token_key);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE VIEW IF NOT EXISTS view_task_source AS
SELECT
    ti.id AS task_instance_id,
    COALESCE(oi.origin_type, ot.origin_type) AS origin_type,
    COALESCE(oi.origin_id, ot.origin_id) AS origin_id,
    COALESCE(oi.origin_event, ot.origin_event) AS origin_event,
    COALESCE(oi.created_at, ot.created_at) AS origin_created_at
FROM task_instances ti
LEFT JOIN task_origins oi
    ON oi.scope = 'instance' AND oi.task_instance_id = ti.id
LEFT JOIN task_origins ot
    ON ot.scope = 'task' AND ot.task_id = ti.task_id
WHERE oi.id IS NOT NULL OR ot.id IS NOT NULL;
--> statement-breakpoint

CREATE VIEW IF NOT EXISTS view_my_tasks AS
SELECT
    ti.id AS task_instance_id,
    ti.task_id,
    t.title,
    t.description,
    t.status AS task_status,
    ti.state AS instance_state,
    ti.due_at,
    ti.start_at,
    ti.completed_at,
    ti.priority_override,
    t.priority_base,
    COALESCE(ti.priority_override, t.priority_base) AS priority_effective,
    t.task_type,
    t.due_mode,
    ti.rank
FROM task_instances ti
JOIN tasks_new t ON t.id = ti.task_id;
--> statement-breakpoint

INSERT OR IGNORE INTO tasks_new (
    id,
    title,
    description,
    status,
    priority_base,
    task_type,
    due_mode,
    default_duration_min,
    created_at,
    updated_at
)
SELECT
    'taskdef-' || id,
    text,
    NULL,
    'active',
    50,
    CASE
        WHEN ticket_id IS NOT NULL AND LENGTH(TRIM(ticket_id)) > 0 THEN 'support'
        ELSE NULL
    END,
    'floating',
    NULL,
    COALESCE(created_at, datetime('now')),
    COALESCE(created_at, datetime('now'))
FROM tasks;
--> statement-breakpoint

INSERT OR IGNORE INTO task_instances (
    id,
    task_id,
    state,
    due_at,
    start_at,
    completed_at,
    generated_from,
    generation_key,
    priority_override,
    rank
)
SELECT
    'taskinst-' || id,
    'taskdef-' || id,
    CASE WHEN completed = 1 THEN 'done' ELSE 'open' END,
    NULL,
    NULL,
    CASE WHEN completed = 1 THEN COALESCE(created_at, datetime('now')) ELSE NULL END,
    'legacy_import',
    'legacy:' || id,
    NULL,
    NULL
FROM tasks;
--> statement-breakpoint

INSERT OR IGNORE INTO task_origins (
    id,
    scope,
    task_id,
    task_instance_id,
    origin_type,
    origin_id,
    origin_event,
    created_at
)
SELECT
    'origin-task-' || id,
    'task',
    'taskdef-' || id,
    NULL,
    CASE
        WHEN ticket_id IS NOT NULL AND LENGTH(TRIM(ticket_id)) > 0 THEN 'ticket'
        ELSE 'manual'
    END,
    CASE
        WHEN ticket_id IS NOT NULL AND LENGTH(TRIM(ticket_id)) > 0 THEN ticket_id
        ELSE 'legacy'
    END,
    'legacy_import',
    COALESCE(created_at, datetime('now'))
FROM tasks;
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
    'link-taskinst-ticket-' || id,
    'task_instance',
    'taskinst-' || id,
    'ticket',
    ticket_id,
    'source',
    COALESCE(created_at, datetime('now')),
    NULL
FROM tasks
WHERE ticket_id IS NOT NULL AND LENGTH(TRIM(ticket_id)) > 0;
