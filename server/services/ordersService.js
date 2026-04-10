import { randomUUID } from 'crypto';

import { sqlite as db } from '../db.js';
import { tableExists } from '../helpers/db-utils.js';
import { getTrackedEmailOrders } from './orderEmailService.js';
import {
    ORDER_ITEM_STATUS_OPTIONS,
    buildOrdersSnapshot,
    normalizeOrderItemRecord,
    normalizeOrderItemStatus
} from '../../shared/orders.js';

const ORDERS_AVAILABLE = () => tableExists('order_items');

const trimText = (value) => String(value || '').trim();
const trimDate = (value) => String(value || '').trim().slice(0, 10);

const listOrderItems = () => {
    if (!ORDERS_AVAILABLE()) return [];
    const rows = db.prepare(`
        SELECT
            id,
            purchase_order_id,
            title,
            description,
            vendor_name,
            category,
            priority,
            quantity,
            unit,
            estimated_cost,
            requested_by,
            needed_by,
            status,
            order_url,
            notes,
            received_quantity,
            returned_quantity,
            return_reason,
            return_requested_at,
            returned_at,
            refund_received_at,
            created_at,
            updated_at
        FROM order_items
        ORDER BY COALESCE(needed_by, created_at) ASC, updated_at DESC
    `).all();
    return rows.map(normalizeOrderItemRecord);
};

const getOrderItem = (id) => {
    if (!ORDERS_AVAILABLE() || !id) return null;
    const row = db.prepare(`
        SELECT
            id,
            purchase_order_id,
            title,
            description,
            vendor_name,
            category,
            priority,
            quantity,
            unit,
            estimated_cost,
            requested_by,
            needed_by,
            status,
            order_url,
            notes,
            received_quantity,
            returned_quantity,
            return_reason,
            return_requested_at,
            returned_at,
            refund_received_at,
            created_at,
            updated_at
        FROM order_items
        WHERE id = ?
        LIMIT 1
    `).get(id);
    return row ? normalizeOrderItemRecord(row) : null;
};

const buildOrderItemWrite = (payload = {}, existing = null) => {
    const base = normalizeOrderItemRecord({
        ...existing,
        ...payload
    });
    return {
        title: base.title,
        requested_by: base.requested_by || null,
        needed_by: trimDate(base.needed_by) || null,
        order_url: base.order_url || null,
        status: normalizeOrderItemStatus(base.status),
        notes: base.notes || null
    };
};

export const buildOrdersPanelData = async () => {
    const items = listOrderItems();
    const emailTracking = await getTrackedEmailOrders();
    const snapshot = buildOrdersSnapshot({
        items,
        emailPackages: emailTracking.packages || []
    });
    return {
        kind: 'orders',
        title: 'Orders',
        ...snapshot,
        mailbox: emailTracking.mailbox || '',
        refreshedAt: emailTracking.refreshedAt || '',
        trackingConnected: !!emailTracking.connected,
        trackingNote: emailTracking.note || '',
        options: {
            itemStatuses: ORDER_ITEM_STATUS_OPTIONS
        },
        autoProgress: false
    };
};

export const createOrderItem = (payload = {}) => {
    if (!ORDERS_AVAILABLE()) throw new Error('Orders module is unavailable');
    const record = buildOrderItemWrite(payload);
    if (!record.title) throw new Error('Product is required');
    if (!record.requested_by) throw new Error('Requested by is required');
    if (!record.needed_by) throw new Error('Date is required');
    const id = `orditem-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO order_items (
            id, purchase_order_id, title, description, vendor_name, category, priority,
            quantity, unit, estimated_cost, requested_by, needed_by, status, order_url,
            notes, received_quantity, returned_quantity, return_reason, return_requested_at,
            returned_at, refund_received_at, created_at, updated_at
        ) VALUES (?, NULL, ?, NULL, NULL, 'other', 'normal', 1, NULL, NULL, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, NULL, ?, ?)
    `).run(
        id,
        record.title,
        record.requested_by,
        record.needed_by,
        record.status,
        record.order_url,
        record.notes,
        now,
        now
    );
    return getOrderItem(id);
};

export const updateOrderItem = (id, payload = {}) => {
    if (!ORDERS_AVAILABLE()) throw new Error('Orders module is unavailable');
    const existing = getOrderItem(id);
    if (!existing) return null;
    const record = buildOrderItemWrite(payload, existing);
    if (!record.title) throw new Error('Product is required');
    if (!record.requested_by) throw new Error('Requested by is required');
    if (!record.needed_by) throw new Error('Date is required');
    const now = new Date().toISOString();
    db.prepare(`
        UPDATE order_items
        SET
            title = ?,
            requested_by = ?,
            needed_by = ?,
            status = ?,
            order_url = ?,
            notes = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        record.title,
        record.requested_by,
        record.needed_by,
        record.status,
        record.order_url,
        record.notes,
        now,
        id
    );
    return getOrderItem(id);
};
