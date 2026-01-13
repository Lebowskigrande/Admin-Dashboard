INSERT OR IGNORE INTO event_types (name, slug, category_id, requires_contract, requires_staffing, requires_setup)
VALUES (
    'Volunteer',
    'volunteer',
    (SELECT id FROM event_categories WHERE slug = 'ministerial'),
    0,
    1,
    0
);
