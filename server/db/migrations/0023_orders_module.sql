CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    vendor_name TEXT NOT NULL,
    order_number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    placed_at TEXT,
    expected_delivery_at TEXT,
    delivered_at TEXT,
    tracking_number TEXT,
    shipping_cost REAL,
    subtotal_amount REAL,
    tax_amount REAL,
    total_amount REAL,
    return_deadline TEXT,
    order_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    vendor_name TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    priority TEXT NOT NULL DEFAULT 'normal',
    quantity INTEGER NOT NULL DEFAULT 1,
    unit TEXT,
    estimated_cost REAL,
    requested_by TEXT,
    needed_by TEXT,
    status TEXT NOT NULL DEFAULT 'needed',
    order_url TEXT,
    notes TEXT,
    received_quantity INTEGER NOT NULL DEFAULT 0,
    returned_quantity INTEGER NOT NULL DEFAULT 0,
    return_reason TEXT,
    return_requested_at TEXT,
    returned_at TEXT,
    refund_received_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_expected
    ON purchase_orders(status, expected_delivery_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_name
    ON purchase_orders(vendor_name);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_order_items_status_needed
    ON order_items(status, needed_by);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_order_items_purchase_order
    ON order_items(purchase_order_id);
--> statement-breakpoint

INSERT OR IGNORE INTO recurring_task_templates (
    id,
    origin_type,
    origin_id,
    list_key,
    list_title,
    list_mode,
    step_key,
    title,
    sort_order,
    due_offset_days,
    anchor_monthdays,
    schedule_rule,
    priority_base,
    active,
    created_at,
    updated_at
) VALUES (
    'tmpl-ops-orders',
    'operations',
    'weekly',
    'ops-weekly',
    'Weekly Ops',
    'parallel',
    'orders',
    'Review orders queue',
    95,
    NULL,
    NULL,
    NULL,
    55,
    1,
    datetime('now'),
    datetime('now')
);
