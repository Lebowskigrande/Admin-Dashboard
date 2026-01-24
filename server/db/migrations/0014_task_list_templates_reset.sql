DELETE FROM recurring_task_templates;
--> statement-breakpoint

INSERT INTO recurring_task_templates (
    id,
    origin_type,
    origin_id,
    list_key,
    list_title,
    list_mode,
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
    -- Sunday Planning
    ('tmpl-sun-roles', 'sunday', NULL, 'roles', 'Liturgical Roles', 'parallel', 'fill-roles', 'Fill liturgical roles', 10, -6, 70, 1, datetime('now'), datetime('now')),

    ('tmpl-sun-bulletin-draft', 'sunday', NULL, 'bulletins', 'Bulletins', 'sequential', 'draft', 'Draft', 10, -5, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-bulletin-review', 'sunday', NULL, 'bulletins', 'Bulletins', 'sequential', 'review', 'Review', 20, -4, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-bulletin-final', 'sunday', NULL, 'bulletins', 'Bulletins', 'sequential', 'finalize', 'Finalize', 30, -2, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-bulletin-print', 'sunday', NULL, 'bulletins', 'Bulletins', 'sequential', 'print', 'Print', 40, -1, 70, 1, datetime('now'), datetime('now')),

    ('tmpl-sun-insert-draft', 'sunday', NULL, 'insert', 'Insert', 'sequential', 'draft', 'Draft', 10, -4, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-insert-review', 'sunday', NULL, 'insert', 'Insert', 'sequential', 'review', 'Review', 20, -3, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-insert-final', 'sunday', NULL, 'insert', 'Insert', 'sequential', 'finalize', 'Finalize', 30, -2, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-insert-print', 'sunday', NULL, 'insert', 'Insert', 'sequential', 'print', 'Print', 40, -1, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-insert-stuff', 'sunday', NULL, 'insert', 'Insert', 'sequential', 'stuff', 'Stuff', 50, 0, 70, 1, datetime('now'), datetime('now')),

    ('tmpl-sun-email-youtube', 'sunday', NULL, 'email', 'Schedule Email', 'sequential', 'youtube', 'Get YouTube link', 10, -3, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-email-upload', 'sunday', NULL, 'email', 'Schedule Email', 'sequential', 'upload', 'Upload bulletin', 20, -2, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-email-build', 'sunday', NULL, 'email', 'Schedule Email', 'sequential', 'build', 'Build email', 30, -1, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sun-email-schedule', 'sunday', NULL, 'email', 'Schedule Email', 'sequential', 'schedule', 'Schedule email', 40, -1, 70, 1, datetime('now'), datetime('now')),

    ('tmpl-sun-events', 'sunday', NULL, 'special-events', 'Special Events', 'parallel', 'special-events', 'Special events', 10, 0, 70, 1, datetime('now'), datetime('now')),

    -- Vestry
    ('tmpl-vestry-pre', 'vestry', NULL, 'prevestry', 'Prevestry Checklist', 'sequential', 'prevestry', 'Prevestry checklist', 10, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-packet', 'vestry', NULL, 'packet', 'Vestry Packet', 'sequential', 'packet', 'Vestry packet', 20, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-certs', 'vestry', NULL, 'certificates', 'Certificates', 'sequential', 'certificates', 'Certificates', 30, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-email', 'vestry', NULL, 'email', 'Email to Vestry', 'sequential', 'email', 'Email to vestry', 40, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-print', 'vestry', NULL, 'print', 'Print Materials', 'sequential', 'print', 'Print materials', 50, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-post', 'vestry', NULL, 'postvestry', 'Post Vestry Checklist', 'sequential', 'postvestry', 'Post vestry checklist', 60, NULL, 60, 1, datetime('now'), datetime('now')),

    -- Weekly Ops
    ('tmpl-ops-deposit-collect', 'operations', 'weekly', 'deposits', 'Deposits', 'sequential', 'collect', 'Get offering/other checks', 10, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-deposit-slips', 'operations', 'weekly', 'deposits', 'Deposits', 'sequential', 'slips', 'Make deposit slips', 20, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-deposit-code', 'operations', 'weekly', 'deposits', 'Deposits', 'sequential', 'code', 'Code checks/envelopes', 30, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-deposit-scan', 'operations', 'weekly', 'deposits', 'Deposits', 'sequential', 'scan', 'Scan checks/envelopes', 40, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-deposit-send', 'operations', 'weekly', 'deposits', 'Deposits', 'sequential', 'send', 'Send deposits to ESP', 50, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-deposit-print', 'operations', 'weekly', 'deposits', 'Deposits', 'sequential', 'print', 'Printer deposits in Gail''s box', 60, NULL, 55, 1, datetime('now'), datetime('now')),

    ('tmpl-ops-bills', 'operations', 'weekly', 'ops-weekly', 'Weekly Ops', 'parallel', 'bills', 'Code bills and send to ESP', 70, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-donations', 'operations', 'weekly', 'ops-weekly', 'Weekly Ops', 'parallel', 'donations', 'Code donations and send to ESP', 80, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-mail', 'operations', 'weekly', 'ops-weekly', 'Weekly Ops', 'parallel', 'mail', 'Mail', 90, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-birthdays', 'operations', 'weekly', 'ops-weekly', 'Weekly Ops', 'parallel', 'birthdays', 'Birthday cards', 100, NULL, 55, 1, datetime('now'), datetime('now')),

    -- Timesheets
    ('tmpl-ops-timesheets-make', 'operations', 'timesheets', 'timesheets', 'Timesheets', 'sequential', 'make', 'Make sheets for exempt staff', 10, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-timesheets-collect', 'operations', 'timesheets', 'timesheets', 'Timesheets', 'sequential', 'collect', 'Collect sheets from non-exempt staff', 20, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-timesheets-send', 'operations', 'timesheets', 'timesheets', 'Timesheets', 'sequential', 'send', 'Scan and send to ESP', 30, NULL, 55, 1, datetime('now'), datetime('now'));
