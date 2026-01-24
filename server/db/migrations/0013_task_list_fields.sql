ALTER TABLE recurring_task_templates ADD COLUMN list_key TEXT;
--> statement-breakpoint
ALTER TABLE recurring_task_templates ADD COLUMN list_title TEXT;
--> statement-breakpoint
ALTER TABLE recurring_task_templates ADD COLUMN list_mode TEXT DEFAULT 'sequential';
--> statement-breakpoint
ALTER TABLE task_instances ADD COLUMN list_key TEXT;
--> statement-breakpoint
ALTER TABLE task_instances ADD COLUMN list_title TEXT;
--> statement-breakpoint
ALTER TABLE task_instances ADD COLUMN list_mode TEXT DEFAULT 'sequential';
