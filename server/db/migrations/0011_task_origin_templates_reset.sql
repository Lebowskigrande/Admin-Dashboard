-- Reset templates and remove unsupported origins

DELETE FROM recurring_task_templates;
--> statement-breakpoint

INSERT INTO recurring_task_templates (
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
    -- Sunday Planning (weekly)
    ('tmpl-sunday-roles', 'sunday', NULL, 'fill-roles', 'Fill liturgical roles', 10, -6, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sunday-bulletins-draft', 'sunday', NULL, 'draft-bulletins', 'Draft bulletins 10/8', 20, -5, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sunday-insert-draft', 'sunday', NULL, 'draft-insert', 'Draft insert', 30, -4, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sunday-bulletins-final', 'sunday', NULL, 'finalize-bulletins', 'Finalize bulletins', 40, -2, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sunday-insert-final', 'sunday', NULL, 'finalize-insert', 'Finalize insert', 50, -2, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sunday-email', 'sunday', NULL, 'schedule-email', 'Schedule email', 60, -1, 70, 1, datetime('now'), datetime('now')),
    ('tmpl-sunday-events', 'sunday', NULL, 'special-events', 'Special events', 70, 0, 70, 1, datetime('now'), datetime('now')),

    -- Vestry (monthly)
    ('tmpl-vestry-pre', 'vestry', NULL, 'prevestry', 'Prevestry checklist', 10, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-packet', 'vestry', NULL, 'packet', 'Vestry packet', 20, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-certs', 'vestry', NULL, 'certificates', 'Certificates', 30, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-email', 'vestry', NULL, 'email', 'Email to vestry', 40, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-print', 'vestry', NULL, 'print', 'Print materials', 50, NULL, 60, 1, datetime('now'), datetime('now')),
    ('tmpl-vestry-post', 'vestry', NULL, 'postvestry', 'Post vestry checklist', 60, NULL, 60, 1, datetime('now'), datetime('now')),

    -- Operations (general origin)
    ('tmpl-ops-weekly-collect', 'operations', 'general', 'weekly-deposit-collect', 'Weekly deposit: get offering/other checks', 10, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-weekly-slips', 'operations', 'general', 'weekly-deposit-slips', 'Weekly deposit: make deposit slips', 20, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-weekly-code', 'operations', 'general', 'weekly-deposit-code', 'Weekly deposit: code checks/envelopes', 30, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-weekly-scan', 'operations', 'general', 'weekly-deposit-scan', 'Weekly deposit: scan checks/envelopes', 40, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-weekly-send', 'operations', 'general', 'weekly-deposit-send', 'Weekly deposit: send deposits to ESP', 50, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-weekly-print', 'operations', 'general', 'weekly-deposit-print', 'Weekly deposit: printer deposits in Gail''s box', 60, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-bills', 'operations', 'general', 'bills-esp', 'Bills coded and sent to ESP', 70, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-donations', 'operations', 'general', 'donations-esp', 'Donations coded and sent to ESP', 80, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-mail', 'operations', 'general', 'mail', 'Mail', 90, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-timesheets-exempt', 'operations', 'general', 'timesheets-exempt', 'Timesheets: make timesheets for exempt staff', 100, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-timesheets-collect', 'operations', 'general', 'timesheets-collect', 'Timesheets: collect timesheets from non-exempt staff', 110, NULL, 55, 1, datetime('now'), datetime('now')),
    ('tmpl-ops-timesheets-send', 'operations', 'general', 'timesheets-send', 'Timesheets: scan and send to ESP', 120, NULL, 55, 1, datetime('now'), datetime('now'));
--> statement-breakpoint

DELETE FROM task_instances
WHERE id IN (
    SELECT ti.id
    FROM task_instances ti
    JOIN task_origins o ON o.task_instance_id = ti.id
    WHERE o.origin_type NOT IN ('sunday', 'ticket', 'vestry', 'event', 'operations')
);
--> statement-breakpoint

DELETE FROM task_origins
WHERE origin_type NOT IN ('sunday', 'ticket', 'vestry', 'event', 'operations');
--> statement-breakpoint

DELETE FROM entity_links
WHERE from_type = 'task_instance'
  AND to_type NOT IN ('sunday', 'ticket', 'vestry', 'event', 'operations');
--> statement-breakpoint

DELETE FROM tasks_new
WHERE id NOT IN (SELECT task_id FROM task_instances);
