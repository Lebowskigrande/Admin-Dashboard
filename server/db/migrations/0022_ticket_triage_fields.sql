ALTER TABLE tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN requested_by TEXT;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN assigned_to TEXT;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN vendor_id TEXT;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN target_date TEXT;
--> statement-breakpoint

UPDATE tickets
SET
    status = CASE
        WHEN status IS NULL OR TRIM(status) = '' THEN 'new'
        WHEN LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_')) = 'reviewed' THEN 'open'
        WHEN LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_')) = 'in_process' THEN 'in_progress'
        WHEN LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_')) = 'closed' THEN 'done'
        ELSE LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_'))
    END,
    priority = COALESCE(NULLIF(TRIM(priority), ''), 'normal'),
    category = COALESCE(NULLIF(TRIM(category), ''), 'general');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_tickets_status_target_date ON tickets(status, target_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tickets_vendor_id ON tickets(vendor_id);
