-- Migrate bulletin-origin tasks/templates to sunday-origin

UPDATE recurring_task_templates
SET origin_type = 'sunday'
WHERE origin_type = 'bulletin';
--> statement-breakpoint

UPDATE task_origins
SET origin_type = 'sunday'
WHERE origin_type = 'bulletin';
--> statement-breakpoint

UPDATE entity_links
SET to_type = 'sunday'
WHERE to_type = 'bulletin';
--> statement-breakpoint

UPDATE entity_links
SET from_type = 'sunday'
WHERE from_type = 'bulletin';
--> statement-breakpoint

UPDATE task_instances
SET generation_key = REPLACE(generation_key, 'bulletin:', 'sunday:')
WHERE generation_key LIKE 'bulletin:%';
--> statement-breakpoint

UPDATE tasks_new
SET task_type = 'sunday'
WHERE task_type = 'bulletin';
