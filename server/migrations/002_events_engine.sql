-- Create event_categories table
CREATE TABLE IF NOT EXISTS event_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    color TEXT NOT NULL,
    description TEXT,
    icon TEXT
);

-- Create event_types table
CREATE TABLE IF NOT EXISTS event_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    category_id INTEGER,
    color TEXT, -- Optional override of category color
    requires_contract BOOLEAN DEFAULT 0,
    requires_staffing BOOLEAN DEFAULT 0,
    requires_setup BOOLEAN DEFAULT 0,
    is_public BOOLEAN DEFAULT 1,
    FOREIGN KEY (category_id) REFERENCES event_categories(id)
);

-- Create custom_events table (to separate from liturgical_days)
CREATE TABLE IF NOT EXISTS custom_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    event_type_id INTEGER,
    date TEXT NOT NULL,
    time TEXT,
    end_time TEXT,
    location TEXT,
    metadata TEXT, -- JSON for type-specific fields (contract, etc.)
    source TEXT DEFAULT 'manual', -- 'manual' or 'google'
    external_id TEXT, -- For Google Calendar sync
    FOREIGN KEY (event_type_id) REFERENCES event_types(id)
);

-- Seed initial categories
INSERT OR IGNORE INTO event_categories (name, slug, color, description) VALUES 
('Liturgical', 'liturgical', '#15803d', 'Principal worship and liturgical observances'),
('Sacramental', 'sacramental', '#FFD700', 'Baptisms, Weddings, Funerals, etc.'),
('Administrative', 'administrative', '#3B82F6', 'Meetings, rehearsals, and staff business'),
('Educational', 'educational', '#14B8A6', 'Classes, formation, and study groups'),
('Cultural', 'cultural', '#A855F7', 'Concerts, lectures, and community arts'),
('Commercial', 'commercial', '#F97316', 'Facility rentals and external contracts'),
('Pastoral', 'pastoral', '#EC4899', 'Counseling, prep, and pastoral care'),
('Operational', 'operational', '#6B7280', 'Maintenance, closures, and cleaning');

-- Seed v1 event types
INSERT OR IGNORE INTO event_types (name, slug, category_id, requires_contract, requires_staffing, requires_setup) VALUES
('Weekly Service', 'weekly-service', 1, 0, 1, 1),
('Special Service', 'special-service', 1, 0, 1, 1),
('Wedding', 'wedding', 2, 1, 1, 1),
('Funeral', 'funeral', 2, 0, 1, 1),
('Meeting', 'meeting', 3, 0, 0, 0),
('Rehearsal', 'rehearsal', 3, 0, 0, 1),
('Class / Formation', 'class-formation', 4, 0, 0, 0),
('Concert', 'concert', 5, 1, 1, 1),
('Private Rental', 'private-rental', 6, 1, 0, 1),
('Maintenance / Closure', 'maintenance-closure', 8, 0, 0, 0);
