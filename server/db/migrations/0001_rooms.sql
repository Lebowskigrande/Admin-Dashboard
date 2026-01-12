CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    building_id TEXT NOT NULL,
    name TEXT NOT NULL,
    floor INTEGER,
    capacity INTEGER,
    rental_rate REAL,
    notes TEXT
);
