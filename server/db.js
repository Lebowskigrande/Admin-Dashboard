import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema.js';
import { vestryChecklistItems } from './vestryChecklistData.js';
import { syncPledgerFlagsInPeople } from './helpers/pledger-utils.js';
import {
    normalizeTicketCategory,
    normalizeTicketPriority,
    normalizeTicketStatus
} from '../shared/tickets.js';
import {
    normalizeOrderCategory,
    normalizeOrderItemStatus,
    normalizeOrderPriority,
    normalizePurchaseOrderStatus
} from '../shared/orders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'church.db');
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

const ensureRuntimeTables = () => {
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS vestry_checklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month INTEGER,
            month_name TEXT,
            phase TEXT,
            task TEXT,
            notes TEXT,
            sort_order INTEGER
        );

        CREATE TABLE IF NOT EXISTS constant_contact_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            access_token TEXT,
            refresh_token TEXT,
            expires_at TEXT,
            scope TEXT,
            token_type TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS event_template_fields (
            id TEXT PRIMARY KEY,
            event_type_id INTEGER NOT NULL,
            field_key TEXT NOT NULL,
            label TEXT NOT NULL,
            field_type TEXT NOT NULL,
            options_json TEXT,
            placeholder TEXT,
            help_text TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            required INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(event_type_id, field_key)
        );

        CREATE TABLE IF NOT EXISTS event_documents (
            id TEXT PRIMARY KEY,
            occurrence_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            label TEXT,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sharefile_job_events (
            id TEXT PRIMARY KEY,
            attempt_id TEXT,
            job_id TEXT,
            message_id TEXT,
            thread_id TEXT,
            code_type TEXT,
            code_value TEXT,
            status TEXT NOT NULL,
            error_text TEXT,
            output_json TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sharefile_routing_accounts (
            user_id TEXT PRIMARY KEY,
            is_default INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sharefile_dashboard_handoffs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            message_id TEXT,
            thread_id TEXT,
            code_type TEXT,
            code_value TEXT,
            route_kind TEXT,
            designation TEXT,
            vendor TEXT,
            amount TEXT,
            shared INTEGER NOT NULL DEFAULT 0,
            church_allocation_percent TEXT,
            school_allocation_percent TEXT,
            page_url TEXT,
            source TEXT,
            created_at TEXT NOT NULL,
            claimed_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS routing_attempts (
            id TEXT PRIMARY KEY,
            job_id TEXT,
            message_id TEXT,
            thread_id TEXT,
            code_type TEXT,
            code_value TEXT,
            source TEXT,
            status TEXT NOT NULL,
            error_text TEXT,
            output_json TEXT,
            written_files_json TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS budget_scan_sources (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            folder_path TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_progress_history (
            id TEXT PRIMARY KEY,
            task_instance_id TEXT NOT NULL,
            task_id TEXT,
            title TEXT,
            action TEXT NOT NULL,
            source TEXT NOT NULL,
            actor TEXT,
            from_state TEXT,
            to_state TEXT,
            from_progress_key TEXT,
            to_progress_key TEXT,
            from_completed_at TEXT,
            to_completed_at TEXT,
            changed_fields_json TEXT,
            before_json TEXT,
            after_json TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_seed_suppressions (
            id TEXT PRIMARY KEY,
            generation_key TEXT NOT NULL UNIQUE,
            origin_type TEXT,
            origin_id TEXT,
            origin_event TEXT,
            task_title TEXT,
            suppressed_at TEXT NOT NULL,
            suppressed_by TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_routing_attempts_created_at ON routing_attempts(created_at);
        CREATE INDEX IF NOT EXISTS idx_routing_attempts_job_id ON routing_attempts(job_id);
        CREATE INDEX IF NOT EXISTS idx_sharefile_dashboard_handoffs_status_created
            ON sharefile_dashboard_handoffs(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_budget_scan_sources_enabled ON budget_scan_sources(enabled);
        CREATE INDEX IF NOT EXISTS idx_task_progress_history_task_instance
            ON task_progress_history(task_instance_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_task_progress_history_created_at
            ON task_progress_history(created_at);
        CREATE INDEX IF NOT EXISTS idx_task_seed_suppressions_origin
            ON task_seed_suppressions(origin_type, origin_id, origin_event);

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

        CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_expected
            ON purchase_orders(status, expected_delivery_at);
        CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_name
            ON purchase_orders(vendor_name);
        CREATE INDEX IF NOT EXISTS idx_order_items_status_needed
            ON order_items(status, needed_by);
        CREATE INDEX IF NOT EXISTS idx_order_items_purchase_order
            ON order_items(purchase_order_id);
    `);
};

const ensureSharefileJobEventsColumns = () => {
    const table = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sharefile_job_events'
    `).get();
    if (!table) return;

    const columns = sqlite.prepare('PRAGMA table_info(sharefile_job_events)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    if (!columnSet.has('attempt_id')) {
        sqlite.exec('ALTER TABLE sharefile_job_events ADD COLUMN attempt_id TEXT');
    }

    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sharefile_job_events_attempt_id ON sharefile_job_events(attempt_id)');
    sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sharefile_job_events_attempt_dedupe
            ON sharefile_job_events(attempt_id, message_id, code_type, code_value, status)
            WHERE attempt_id IS NOT NULL
    `);
};

const ensureRecurringTaskTemplateColumns = () => {
    const table = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_task_templates'
    `).get();
    if (!table) return;

    const columns = sqlite.prepare('PRAGMA table_info(recurring_task_templates)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    if (!columnSet.has('anchor_monthdays')) {
        sqlite.exec('ALTER TABLE recurring_task_templates ADD COLUMN anchor_monthdays TEXT');
    }
    if (!columnSet.has('behavior_notes')) {
        sqlite.exec('ALTER TABLE recurring_task_templates ADD COLUMN behavior_notes TEXT');
    }
    if (!columnSet.has('schedule_rule')) {
        sqlite.exec('ALTER TABLE recurring_task_templates ADD COLUMN schedule_rule TEXT');
    }
};

const ensureCalendarPolicyColumns = () => {
    const table = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'calendar_links'
    `).get();
    if (!table) return;

    const columns = sqlite.prepare('PRAGMA table_info(calendar_links)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    const addColumn = (name, definition) => {
        if (!columnSet.has(name)) {
            sqlite.exec(`ALTER TABLE calendar_links ADD COLUMN ${name} ${definition}`);
            columnSet.add(name);
        }
    };

    addColumn('calendar_role', "TEXT NOT NULL DEFAULT 'work'");
    addColumn('import_mode', "TEXT NOT NULL DEFAULT 'classify'");
    addColumn('task_policy', "TEXT NOT NULL DEFAULT 'auto'");
    addColumn('display_group', "TEXT NOT NULL DEFAULT 'Work'");
    addColumn('default_entry_kind', "TEXT NOT NULL DEFAULT 'event'");
};

const seedVestryChecklist = () => {
    const count = sqlite.prepare('SELECT count(*) as count FROM vestry_checklist').get().count;
    if (count === vestryChecklistItems.length) return;
    if (count > 0) {
        sqlite.prepare('DELETE FROM vestry_checklist').run();
    }
    const insert = sqlite.prepare(`
        INSERT INTO vestry_checklist (month, month_name, phase, task, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    vestryChecklistItems.forEach((item) => {
        insert.run(
            item.month,
            item.monthName,
            item.phase,
            item.task,
            item.notes || '',
            item.sortOrder || 0
        );
    });
};

const ensurePeopleColumns = () => {
    const table = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'
    `).get();
    if (!table) return;
    const columns = sqlite.prepare('PRAGMA table_info(people)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    const addColumn = (name) => {
        if (!columnSet.has(name)) {
            sqlite.exec(`ALTER TABLE people ADD COLUMN ${name} TEXT`);
            columnSet.add(name);
        }
    };

    addColumn('phone_primary');
    addColumn('phone_alternate');
    addColumn('address_line1');
    addColumn('address_line2');
    addColumn('city');
    addColumn('state');
    addColumn('postal_code');
    addColumn('envelope_number');
    addColumn('is_pledger');
};

const ensureTicketColumns = () => {
    const table = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tickets'
    `).get();
    if (!table) return;

    const columns = sqlite.prepare('PRAGMA table_info(tickets)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    const addColumn = (name, definition) => {
        if (!columnSet.has(name)) {
            sqlite.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${definition}`);
            columnSet.add(name);
        }
    };

    addColumn('priority', "TEXT NOT NULL DEFAULT 'normal'");
    addColumn('category', "TEXT NOT NULL DEFAULT 'general'");
    addColumn('requested_by', 'TEXT');
    addColumn('assigned_to', 'TEXT');
    addColumn('vendor_id', 'TEXT');
    addColumn('target_date', 'TEXT');

    sqlite.exec(`
        UPDATE tickets
        SET
            status = CASE
                WHEN status IS NULL OR TRIM(status) = '' THEN 'new'
                WHEN LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_')) = 'reviewed' THEN 'open'
                WHEN LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_')) = 'in_process' THEN 'in_progress'
                WHEN LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_')) = 'closed' THEN 'done'
                ELSE LOWER(REPLACE(REPLACE(status, ' ', '_'), '-', '_'))
            END
    `);

    const rows = sqlite.prepare('SELECT id, status, priority, category FROM tickets').all();
    const update = sqlite.prepare(`
        UPDATE tickets
        SET status = ?, priority = ?, category = ?
        WHERE id = ?
    `);
    rows.forEach((row) => {
        update.run(
            normalizeTicketStatus(row.status),
            normalizeTicketPriority(row.priority),
            normalizeTicketCategory(row.category),
            row.id
        );
    });

    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status_target_date ON tickets(status, target_date)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tickets_vendor_id ON tickets(vendor_id)');
};

const ensureOrdersModule = () => {
    if (sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'purchase_orders'
    `).get()) {
        sqlite.exec(`
            UPDATE purchase_orders
            SET status = LOWER(REPLACE(REPLACE(COALESCE(status, 'draft'), ' ', '_'), '-', '_'))
        `);
        const orders = sqlite.prepare(`
            SELECT id, status FROM purchase_orders
        `).all();
        const updateOrder = sqlite.prepare(`
            UPDATE purchase_orders
            SET status = ?
            WHERE id = ?
        `);
        orders.forEach((row) => {
            updateOrder.run(normalizePurchaseOrderStatus(row.status), row.id);
        });
    }

    if (sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'order_items'
    `).get()) {
        sqlite.exec(`
            UPDATE order_items
            SET
                status = LOWER(REPLACE(REPLACE(COALESCE(status, 'needed'), ' ', '_'), '-', '_')),
                priority = LOWER(REPLACE(REPLACE(COALESCE(priority, 'normal'), ' ', '_'), '-', '_')),
                category = LOWER(REPLACE(REPLACE(COALESCE(category, 'other'), ' ', '_'), '-', '_'))
        `);
        const items = sqlite.prepare(`
            SELECT id, status, priority, category FROM order_items
        `).all();
        const updateItem = sqlite.prepare(`
            UPDATE order_items
            SET status = ?, priority = ?, category = ?
            WHERE id = ?
        `);
        items.forEach((row) => {
            updateItem.run(
                normalizeOrderItemStatus(row.status),
                normalizeOrderPriority(row.priority),
                normalizeOrderCategory(row.category),
                row.id
            );
        });
    }

    if (sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_task_templates'
    `).get()) {
        sqlite.prepare(`
            INSERT OR IGNORE INTO recurring_task_templates (
                id, origin_type, origin_id, list_key, list_title, list_mode,
                step_key, title, sort_order, due_offset_days, anchor_monthdays,
                schedule_rule, priority_base, active, created_at, updated_at
            ) VALUES (
                'tmpl-ops-orders', 'operations', 'weekly', 'ops-weekly', 'Weekly Ops', 'parallel',
                'orders', 'Review orders queue', 95, NULL, NULL,
                NULL, 55, 1, datetime('now'), datetime('now')
            )
        `).run();
    }
};

export const initializeDatabaseRuntime = () => {
    ensureRuntimeTables();
    ensureSharefileJobEventsColumns();
    ensureRecurringTaskTemplateColumns();
    ensureCalendarPolicyColumns();
    ensurePeopleColumns();
    ensureTicketColumns();
    ensureOrdersModule();
    console.log('Database runtime initialized at', dbPath);
};

export const syncDatabaseDerivedState = () => {
    seedVestryChecklist();
    syncPledgerFlagsInPeople(sqlite);
};

export { sqlite, db };
export default sqlite;
