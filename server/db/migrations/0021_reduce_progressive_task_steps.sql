UPDATE recurring_task_templates
SET title = 'Draft and review',
    sort_order = 10,
    due_offset_days = -4,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-bulletin-draft';
--> statement-breakpoint

UPDATE recurring_task_templates
SET step_key = 'finalize',
    title = 'Finalize and print',
    sort_order = 20,
    due_offset_days = -1,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-bulletin-final';
--> statement-breakpoint

DELETE FROM recurring_task_templates
WHERE id IN ('tmpl-sun-bulletin-review', 'tmpl-sun-bulletin-print');
--> statement-breakpoint

UPDATE recurring_task_templates
SET title = 'Draft and review',
    sort_order = 10,
    due_offset_days = -3,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-insert-draft';
--> statement-breakpoint

UPDATE recurring_task_templates
SET step_key = 'finalize',
    title = 'Finalize and print',
    sort_order = 20,
    due_offset_days = -1,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-insert-final';
--> statement-breakpoint

UPDATE recurring_task_templates
SET sort_order = 30,
    due_offset_days = 0,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-insert-stuff';
--> statement-breakpoint

DELETE FROM recurring_task_templates
WHERE id IN ('tmpl-sun-insert-review', 'tmpl-sun-insert-print');
--> statement-breakpoint

UPDATE recurring_task_templates
SET step_key = 'prep',
    title = 'Get YouTube link and upload bulletin',
    sort_order = 10,
    due_offset_days = -2,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-email-youtube';
--> statement-breakpoint

UPDATE recurring_task_templates
SET title = 'Build and schedule email',
    sort_order = 20,
    due_offset_days = -1,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-sun-email-schedule';
--> statement-breakpoint

DELETE FROM recurring_task_templates
WHERE id IN ('tmpl-sun-email-upload', 'tmpl-sun-email-build');
--> statement-breakpoint

UPDATE recurring_task_templates
SET title = 'Collect checks and make slips',
    sort_order = 10,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-ops-deposit-collect';
--> statement-breakpoint

UPDATE recurring_task_templates
SET step_key = 'process',
    title = 'Code and scan checks/envelopes',
    sort_order = 20,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-ops-deposit-code';
--> statement-breakpoint

UPDATE recurring_task_templates
SET step_key = 'deliver',
    title = 'Send to ESP and print for Gail',
    sort_order = 30,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-ops-deposit-send';
--> statement-breakpoint

DELETE FROM recurring_task_templates
WHERE id IN ('tmpl-ops-deposit-slips', 'tmpl-ops-deposit-scan', 'tmpl-ops-deposit-print');
--> statement-breakpoint

UPDATE recurring_task_templates
SET sort_order = 10,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-ops-timesheets-make';
--> statement-breakpoint

UPDATE recurring_task_templates
SET step_key = 'submit',
    title = 'Collect, scan, and send to ESP',
    sort_order = 20,
    list_mode = 'progressive',
    updated_at = datetime('now')
WHERE id = 'tmpl-ops-timesheets-send';
--> statement-breakpoint

DELETE FROM recurring_task_templates
WHERE id = 'tmpl-ops-timesheets-collect';
--> statement-breakpoint

UPDATE task_instances
SET progress_steps = '[{"key":"draft","title":"Draft and review","sort_order":10,"due_offset_days":-4},{"key":"finalize","title":"Finalize and print","sort_order":20,"due_offset_days":-1}]',
    progress_key = CASE
        WHEN progress_key IN ('draft', 'review') THEN 'draft'
        WHEN progress_key IN ('finalize', 'print') THEN 'finalize'
        ELSE COALESCE(progress_key, 'draft')
    END,
    list_mode = 'progressive',
    list_title = 'Bulletins'
WHERE id IN (
    SELECT ti.id
    FROM task_instances ti
    JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
    WHERE src.origin_type = 'sunday'
      AND ti.list_key = 'bulletins'
      AND ti.completed_at IS NULL
      AND COALESCE(ti.state, 'open') != 'done'
);
--> statement-breakpoint

UPDATE task_instances
SET progress_steps = '[{"key":"draft","title":"Draft and review","sort_order":10,"due_offset_days":-3},{"key":"finalize","title":"Finalize and print","sort_order":20,"due_offset_days":-1},{"key":"stuff","title":"Stuff","sort_order":30,"due_offset_days":0}]',
    progress_key = CASE
        WHEN progress_key IN ('draft', 'review') THEN 'draft'
        WHEN progress_key IN ('finalize', 'print') THEN 'finalize'
        WHEN progress_key = 'stuff' THEN 'stuff'
        ELSE COALESCE(progress_key, 'draft')
    END,
    list_mode = 'progressive',
    list_title = 'Insert'
WHERE id IN (
    SELECT ti.id
    FROM task_instances ti
    JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
    WHERE src.origin_type = 'sunday'
      AND ti.list_key = 'insert'
      AND ti.completed_at IS NULL
      AND COALESCE(ti.state, 'open') != 'done'
);
--> statement-breakpoint

UPDATE task_instances
SET progress_steps = '[{"key":"prep","title":"Get YouTube link and upload bulletin","sort_order":10,"due_offset_days":-2},{"key":"schedule","title":"Build and schedule email","sort_order":20,"due_offset_days":-1}]',
    progress_key = CASE
        WHEN progress_key IN ('youtube', 'upload', 'prep') THEN 'prep'
        WHEN progress_key IN ('build', 'schedule') THEN 'schedule'
        ELSE COALESCE(progress_key, 'prep')
    END,
    list_mode = 'progressive',
    list_title = 'Schedule Email'
WHERE id IN (
    SELECT ti.id
    FROM task_instances ti
    JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
    WHERE src.origin_type = 'sunday'
      AND ti.list_key = 'email'
      AND ti.completed_at IS NULL
      AND COALESCE(ti.state, 'open') != 'done'
);
--> statement-breakpoint

UPDATE task_instances
SET progress_steps = '[{"key":"collect","title":"Collect checks and make slips","sort_order":10,"due_offset_days":null},{"key":"process","title":"Code and scan checks/envelopes","sort_order":20,"due_offset_days":null},{"key":"deliver","title":"Send to ESP and print for Gail","sort_order":30,"due_offset_days":null}]',
    progress_key = CASE
        WHEN progress_key IN ('collect', 'slips') THEN 'collect'
        WHEN progress_key IN ('code', 'scan', 'process') THEN 'process'
        WHEN progress_key IN ('send', 'print', 'deliver') THEN 'deliver'
        ELSE COALESCE(progress_key, 'collect')
    END,
    list_mode = 'progressive',
    list_title = 'Deposits'
WHERE id IN (
    SELECT ti.id
    FROM task_instances ti
    JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
    WHERE src.origin_type = 'operations'
      AND ti.list_key = 'deposits'
      AND ti.completed_at IS NULL
      AND COALESCE(ti.state, 'open') != 'done'
);
--> statement-breakpoint

UPDATE task_instances
SET progress_steps = '[{"key":"make","title":"Make sheets for exempt staff","sort_order":10,"due_offset_days":null},{"key":"submit","title":"Collect, scan, and send to ESP","sort_order":20,"due_offset_days":null}]',
    progress_key = CASE
        WHEN progress_key = 'make' THEN 'make'
        WHEN progress_key IN ('collect', 'send', 'submit') THEN 'submit'
        ELSE COALESCE(progress_key, 'make')
    END,
    list_mode = 'progressive',
    list_title = 'Timesheets'
WHERE id IN (
    SELECT ti.id
    FROM task_instances ti
    JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
    WHERE src.origin_type = 'operations'
      AND ti.list_key = 'timesheets'
      AND ti.completed_at IS NULL
      AND COALESCE(ti.state, 'open') != 'done'
);
