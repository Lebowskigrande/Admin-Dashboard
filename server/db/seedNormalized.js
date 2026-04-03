import { sqlite } from '../db.js';

const DEFAULT_BUILDINGS = [
    { id: 'sanctuary', name: 'Church', category: 'Worship', notes: 'Main worship space, nave, and sacristy access.' },
    { id: 'chapel', name: 'Chapel', category: 'Worship', notes: 'Weekday services and quiet prayer.' },
    { id: 'parish-hall', name: 'Fellows Hall', category: 'All Purpose', notes: 'Fellowship hall, kitchens, and meeting rooms.' },
    { id: 'office', name: 'Office/School', category: 'All Purpose', notes: 'Administration, classrooms, and staff workspace.' },
    { id: 'parking-north', name: 'North Parking', category: 'Parking', notes: 'Primary lot with 48 spaces and ADA access.' },
    { id: 'parking-south', name: 'South Parking', category: 'Parking', notes: 'Overflow lot and service access.' },
    { id: 'playground', name: 'Playground', category: 'Grounds', notes: 'Outdoor play area and family gathering space.' },
    { id: 'close', name: 'Close', category: 'Grounds', notes: 'Green space, garden beds, and footpaths.' },
    { id: 'main-gate', name: 'Main Gate', category: 'Entry', notes: 'Main pedestrian entry off the street.' },
    { id: 'south-parking-gate', name: 'South Parking Gate', category: 'Entry', notes: 'Gate access to the south parking lot.' },
    { id: 'north-parking-gate', name: 'North Parking Gate', category: 'Entry', notes: 'Gate access to the north parking lot.' }
];

const DEFAULT_EVENT_CATEGORIES = [
    { name: 'Liturgical', slug: 'liturgical', color: '#15803d', description: 'Principal worship and liturgical observances' },
    { name: 'Sacramental', slug: 'sacramental', color: '#FFD700', description: 'Baptisms, Weddings, Funerals, etc.' },
    { name: 'Administrative', slug: 'administrative', color: '#3B82F6', description: 'Meetings, rehearsals, and staff business' },
    { name: 'Educational', slug: 'educational', color: '#14B8A6', description: 'Classes, formation, and study groups' },
    { name: 'Cultural', slug: 'cultural', color: '#A855F7', description: 'Concerts, lectures, and community arts' },
    { name: 'Commercial', slug: 'commercial', color: '#F97316', description: 'Facility rentals and external contracts' },
    { name: 'Ministerial', slug: 'ministerial', color: '#EC4899', description: 'Ministerial care, outreach, and volunteer operations' },
    { name: 'Operational', slug: 'operational', color: '#6B7280', description: 'Maintenance, closures, and cleaning' }
];

const DEFAULT_EVENT_TYPES = [
    { name: 'Volunteer', slug: 'volunteer', categorySlug: 'ministerial', requiresContract: 0, requiresStaffing: 1, requiresSetup: 0 },
    { name: 'Sunday Service (Legacy)', slug: 'weekly-service', categorySlug: 'liturgical', requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Rite I', slug: 'rite-i-service', categorySlug: 'liturgical', requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Rite II', slug: 'rite-ii-service', categorySlug: 'liturgical', requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Eucharist', slug: 'eucharist-service', categorySlug: 'liturgical', requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Special', slug: 'special-service', categorySlug: 'liturgical', requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Wedding', slug: 'wedding', categorySlug: 'sacramental', requiresContract: 1, requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Funeral', slug: 'funeral', categorySlug: 'sacramental', requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Meeting', slug: 'meeting', categorySlug: 'administrative' },
    { name: 'Rehearsal', slug: 'rehearsal', categorySlug: 'administrative', requiresSetup: 1 },
    { name: 'Class / Formation', slug: 'class-formation', categorySlug: 'educational' },
    { name: 'Concert', slug: 'concert', categorySlug: 'cultural', requiresContract: 1, requiresStaffing: 1, requiresSetup: 1 },
    { name: 'Private Rental', slug: 'private-rental', categorySlug: 'commercial', requiresContract: 1, requiresSetup: 1 },
    { name: 'Maintenance / Closure', slug: 'maintenance-closure', categorySlug: 'operational' }
];

const DEFAULT_EVENT_TEMPLATE_FIELDS = {
    'meeting': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 },
        { fieldKey: 'rental', label: 'Rental', fieldType: 'checkbox', sortOrder: 20 },
        { fieldKey: 'rental_rate', label: 'Rental Rate', fieldType: 'number', placeholder: '0', sortOrder: 30 }
    ],
    'rehearsal': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 },
        { fieldKey: 'rental', label: 'Rental', fieldType: 'checkbox', sortOrder: 20 },
        { fieldKey: 'rental_rate', label: 'Rental Rate', fieldType: 'number', placeholder: '0', sortOrder: 30 }
    ],
    'class-formation': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 },
        { fieldKey: 'rental', label: 'Rental', fieldType: 'checkbox', sortOrder: 20 },
        { fieldKey: 'rental_rate', label: 'Rental Rate', fieldType: 'number', placeholder: '0', sortOrder: 30 }
    ],
    'volunteer': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 },
        { fieldKey: 'rental', label: 'Rental', fieldType: 'checkbox', sortOrder: 20 },
        { fieldKey: 'rental_rate', label: 'Rental Rate', fieldType: 'number', placeholder: '0', sortOrder: 30 }
    ],
    'maintenance-closure': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 }
    ],
    'wedding': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 }
    ],
    'funeral': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 }
    ],
    'concert': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 },
        { fieldKey: 'rental', label: 'Rental', fieldType: 'checkbox', sortOrder: 20 },
        { fieldKey: 'rental_rate', label: 'Rental Rate', fieldType: 'number', placeholder: '0', sortOrder: 30 }
    ],
    'private-rental': [
        { fieldKey: 'contact_person', label: 'Contact Person', fieldType: 'text', placeholder: 'Primary contact', sortOrder: 10 },
        { fieldKey: 'rental_rate', label: 'Rental Rate', fieldType: 'number', placeholder: '0', sortOrder: 20 }
    ]
};

const getCategoryIdMap = () => {
    const rows = sqlite.prepare('SELECT id, slug FROM event_categories').all();
    const map = new Map();
    rows.forEach((row) => map.set(row.slug, row.id));
    return map;
};

export const seedNormalized = () => {
    const hasTable = (name) => sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name);

    if (hasTable('event_categories')) {
        const insert = sqlite.prepare(`
            INSERT INTO event_categories (name, slug, color, description)
            VALUES (?, ?, ?, ?)
        `);
        const update = sqlite.prepare(`
            UPDATE event_categories
            SET name = ?, color = ?, description = ?
            WHERE id = ?
        `);
        DEFAULT_EVENT_CATEGORIES.forEach((category) => {
            const existing = sqlite.prepare('SELECT id FROM event_categories WHERE slug = ?').get(category.slug);
            if (existing?.id) {
                update.run(category.name, category.color, category.description, existing.id);
                return;
            }
            insert.run(category.name, category.slug, category.color, category.description);
        });
    }

    if (hasTable('event_types') && hasTable('event_categories')) {
        const categoryMap = getCategoryIdMap();
        const insert = sqlite.prepare(`
            INSERT INTO event_types (name, slug, category_id, requires_contract, requires_staffing, requires_setup)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const update = sqlite.prepare(`
            UPDATE event_types
            SET name = ?,
                category_id = ?,
                requires_contract = ?,
                requires_staffing = ?,
                requires_setup = ?
            WHERE id = ?
        `);
        DEFAULT_EVENT_TYPES.forEach((type) => {
            const categoryId = categoryMap.get(type.categorySlug) || null;
            const existing = sqlite.prepare('SELECT id FROM event_types WHERE slug = ?').get(type.slug);
            if (existing?.id) {
                update.run(
                    type.name,
                    categoryId,
                    type.requiresContract || 0,
                    type.requiresStaffing || 0,
                    type.requiresSetup || 0,
                    existing.id
                );
                return;
            }
            insert.run(
                type.name,
                type.slug,
                categoryId,
                type.requiresContract || 0,
                type.requiresStaffing || 0,
                type.requiresSetup || 0
            );
        });
    }

    if (hasTable('buildings')) {
        const insert = sqlite.prepare(`
            INSERT INTO buildings (
                id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                category = excluded.category,
                notes = excluded.notes
        `);
        DEFAULT_BUILDINGS.forEach((building) => {
            insert.run(
                building.id,
                building.name,
                building.category,
                0,
                0,
                0,
                0,
                0,
                JSON.stringify([]),
                building.notes || ''
            );
        });
    }

    if (hasTable('event_template_fields') && hasTable('event_types')) {
        const typeRows = sqlite.prepare('SELECT id, slug FROM event_types').all();
        const typeIdBySlug = new Map(typeRows.map((row) => [row.slug, row.id]));
        const keepIds = new Set();

        Object.entries(DEFAULT_EVENT_TEMPLATE_FIELDS).forEach(([slug, fields]) => {
            const eventTypeId = typeIdBySlug.get(slug);
            if (!eventTypeId) return;
            fields.forEach((field) => {
                const id = `tmpl-field-${slug}-${field.fieldKey}`;
                keepIds.add(id);
                const existing = sqlite.prepare('SELECT id FROM event_template_fields WHERE id = ?').get(id);
                if (existing?.id) {
                    sqlite.prepare(`
                        UPDATE event_template_fields
                        SET event_type_id = ?,
                            field_key = ?,
                            label = ?,
                            field_type = ?,
                            options_json = ?,
                            placeholder = ?,
                            help_text = ?,
                            sort_order = ?,
                            required = ?,
                            updated_at = datetime('now')
                        WHERE id = ?
                    `).run(
                        eventTypeId,
                        field.fieldKey,
                        field.label,
                        field.fieldType,
                        field.options ? JSON.stringify(field.options) : null,
                        field.placeholder || null,
                        field.helpText || null,
                        field.sortOrder || 0,
                        field.required ? 1 : 0,
                        id
                    );
                    return;
                }
                sqlite.prepare(`
                    INSERT INTO event_template_fields (
                        id, event_type_id, field_key, label, field_type, options_json,
                        placeholder, help_text, sort_order, required, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                `).run(
                    id,
                    eventTypeId,
                    field.fieldKey,
                    field.label,
                    field.fieldType,
                    field.options ? JSON.stringify(field.options) : null,
                    field.placeholder || null,
                    field.helpText || null,
                    field.sortOrder || 0,
                    field.required ? 1 : 0
                );
            });
        });

        const existingFields = sqlite.prepare(`
            SELECT id FROM event_template_fields WHERE id LIKE 'tmpl-field-%'
        `).all();
        existingFields.forEach((row) => {
            if (keepIds.has(row.id)) return;
            sqlite.prepare('DELETE FROM event_template_fields WHERE id = ?').run(row.id);
        });
    }
};
