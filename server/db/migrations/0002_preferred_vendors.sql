CREATE TABLE IF NOT EXISTS preferred_vendors (
    id TEXT PRIMARY KEY,
    service TEXT,
    vendor TEXT NOT NULL,
    contact TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    contract TEXT
);
