-- Remove legacy Sunday bulletin task instances that split bulletin progress
-- into separate list keys. Sunday + Todo now share canonical list keys.

CREATE TEMP TABLE _legacy_sunday_bulletin_instances AS
SELECT id, task_id
FROM task_instances
WHERE list_key IN ('bulletins-10am', 'bulletins-8am')
  AND id IN (
      SELECT task_instance_id
      FROM task_origins
      WHERE origin_type = 'sunday'
  );
--> statement-breakpoint

DELETE FROM entity_links
WHERE (from_type = 'task_instance' AND from_id IN (SELECT id FROM _legacy_sunday_bulletin_instances))
   OR (to_type = 'task_instance' AND to_id IN (SELECT id FROM _legacy_sunday_bulletin_instances));
--> statement-breakpoint

DELETE FROM task_origins
WHERE task_instance_id IN (SELECT id FROM _legacy_sunday_bulletin_instances);
--> statement-breakpoint

DELETE FROM task_tokens
WHERE task_instance_id IN (SELECT id FROM _legacy_sunday_bulletin_instances);
--> statement-breakpoint

DELETE FROM task_instances
WHERE id IN (SELECT id FROM _legacy_sunday_bulletin_instances);
--> statement-breakpoint

DELETE FROM tasks_new
WHERE id IN (
    SELECT DISTINCT task_id
    FROM _legacy_sunday_bulletin_instances
)
AND id NOT IN (SELECT DISTINCT task_id FROM task_instances);
--> statement-breakpoint

DROP TABLE _legacy_sunday_bulletin_instances;
