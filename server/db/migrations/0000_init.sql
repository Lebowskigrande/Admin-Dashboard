-- Drizzle migration: initial normalized schema
CREATE TABLE IF NOT EXISTS liturgical_days (
    date TEXT PRIMARY KEY,
    feast TEXT,
    color TEXT,
    readings TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER,
    scope TEXT,
    token_type TEXT,
    created_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    background_color TEXT,
    time_zone TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS calendar_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    selected INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    category TEXT,
    roles TEXT,
    tags TEXT,
    teams TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    capacity INTEGER DEFAULT 0,
    size_sqft INTEGER DEFAULT 0,
    rental_rate_hour REAL DEFAULT 0,
    rental_rate_day REAL DEFAULT 0,
    parking_spaces INTEGER DEFAULT 0,
    event_types TEXT,
    notes TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS event_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT,
    icon TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS event_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    category_id INTEGER,
    color TEXT,
    requires_contract INTEGER DEFAULT 0,
    requires_staffing INTEGER DEFAULT 0,
    requires_setup INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 1
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_type_id INTEGER,
    source TEXT DEFAULT 'manual',
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS event_occurrences (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    building_id TEXT,
    rite TEXT,
    is_default INTEGER DEFAULT 0,
    notes TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    occurrence_id TEXT NOT NULL,
    role_key TEXT NOT NULL,
    person_id TEXT NOT NULL
);
