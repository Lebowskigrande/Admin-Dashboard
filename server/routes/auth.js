import express from 'express';
import { sqlite as db } from '../db.js';
import { clearSessionCookie, parseCookies, SESSION_COOKIE } from '../helpers/auth.js';

const router = express.Router();

router.get('/me', (req, res) => {
    if (!req.user) {
        return res.json({ user: null });
    }
    res.json({ user: req.user });
});

router.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
        db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
    }
    clearSessionCookie(res);
    res.json({ success: true });
});

export default router;
