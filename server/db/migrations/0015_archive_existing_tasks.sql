UPDATE task_instances
SET archived_at = COALESCE(archived_at, datetime('now'))
WHERE archived_at IS NULL;
