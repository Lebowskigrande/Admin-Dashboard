import express from 'express';

import {
    buildOrdersPanelData,
    createOrderItem,
    updateOrderItem
} from '../services/ordersService.js';

const router = express.Router();

router.get('/orders/panel-data', async (_req, res) => {
    try {
        return res.json(await buildOrdersPanelData());
    } catch (error) {
        const message = String(error?.message || 'Failed to load orders panel data');
        return res.status(500).json({ error: message });
    }
});

router.post('/orders/items', (req, res) => {
    try {
        const created = createOrderItem(req.body || {});
        return res.status(201).json(created);
    } catch (error) {
        const message = String(error?.message || 'Failed to create order item');
        const status = /required|unavailable/i.test(message) ? 400 : 500;
        return res.status(status).json({ error: message });
    }
});

router.put('/orders/items/:id', (req, res) => {
    try {
        const updated = updateOrderItem(req.params.id, req.body || {});
        if (!updated) return res.status(404).json({ error: 'Order item not found' });
        return res.json(updated);
    } catch (error) {
        const message = String(error?.message || 'Failed to update order item');
        const status = /required|unavailable/i.test(message) ? 400 : 500;
        return res.status(status).json({ error: message });
    }
});

export default router;
