UPDATE recurring_task_templates
SET anchor_monthdays = '10,25',
    schedule_rule = 'friday_before_monday_before_anchor',
    updated_at = datetime('now')
WHERE origin_type = 'operations'
  AND origin_id = 'timesheets';
