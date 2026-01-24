ALTER TABLE task_instances ADD COLUMN archived_at TEXT;
--> statement-breakpoint
ALTER TABLE task_instances ADD COLUMN archive_after_due INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE task_instances ADD COLUMN keep_until TEXT;
