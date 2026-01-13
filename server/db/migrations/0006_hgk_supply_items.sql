CREATE TABLE IF NOT EXISTS hgk_supply_items (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity TEXT,
    notes TEXT,
    status TEXT DEFAULT 'needed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES hgk_supply_requests(id) ON DELETE CASCADE
);
