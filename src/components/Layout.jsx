import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { API_URL } from '../services/apiConfig';
import './Layout.css';

const DASHBOARD_HANDOFF_POLL_MS = 5000;
const DASHBOARD_HANDOFF_FLASH_MS = 1000;

const requestDashboardAttention = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

    const originalTitle = document.title;
    let flashState = false;
    const focusNow = () => {
        try {
            window.focus();
        } catch {
            // Ignore focus failures caused by browser policy.
        }
    };

    focusNow();
    const flashTimer = window.setInterval(() => {
        flashState = !flashState;
        document.title = flashState ? 'Finance routing ready' : originalTitle;
        focusNow();
    }, DASHBOARD_HANDOFF_FLASH_MS);

    const stop = () => {
        window.clearInterval(flashTimer);
        document.title = originalTitle;
        window.removeEventListener('focus', stop);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    const handleVisibilityChange = () => {
        if (!document.hidden) stop();
    };

    window.addEventListener('focus', stop);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (typeof window.Notification === 'function' && Notification.permission === 'granted') {
        try {
            const notice = new Notification('Finance routing ready', {
                body: 'A queued Gmail invoice is ready in the Finance dashboard.'
            });
            window.setTimeout(() => notice.close(), 7000);
        } catch {
            // Ignore notification failures.
        }
    }

    return stop;
};

const Layout = () => {
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const dashboardRoute = String(params.get('dashboardRoute') || '').trim();
        if (!dashboardRoute) return;
        if (!dashboardRoute.startsWith('/')) return;
        const currentUrl = `${location.pathname}${location.search}`;
        if (currentUrl === dashboardRoute) return;
        navigate(dashboardRoute, { replace: true });
    }, [location.pathname, location.search, navigate]);

    useEffect(() => {
        let cancelled = false;
        let busy = false;

        const hasActiveEmailRoutingIntent = () => {
            const params = new URLSearchParams(window.location.search);
            const enabled = String(params.get('emailRouting') || '').trim().toLowerCase();
            if (enabled !== '1' && enabled !== 'true') return false;
            const handoffId = String(params.get('handoffId') || '').trim();
            const messageId = String(params.get('messageId') || '').trim();
            const threadId = String(params.get('threadId') || '').trim();
            return Boolean(handoffId || messageId || threadId);
        };

        const claimDashboardHandoff = async () => {
            if (cancelled || busy || hasActiveEmailRoutingIntent()) return;
            busy = true;
            try {
                const response = await fetch(`${API_URL}/sharefile/dashboard-handoffs/claim`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload?.ok || !payload?.handoff) return;
                const handoff = payload.handoff;
                const params = new URLSearchParams();
                params.set('emailRouting', '1');
                if (handoff?.id) params.set('handoffId', String(handoff.id).trim());
                if (handoff?.gmail?.messageId) params.set('messageId', String(handoff.gmail.messageId).trim());
                if (handoff?.gmail?.threadId) params.set('threadId', String(handoff.gmail.threadId).trim());
                if (handoff?.routeKind) params.set('routeKind', String(handoff.routeKind).trim());
                if (handoff?.codeValue) params.set('codeValue', String(handoff.codeValue).trim());
                if (handoff?.vendor) params.set('vendor', String(handoff.vendor).trim());
                if (handoff?.amount) params.set('amount', String(handoff.amount).trim());
                const stopAttention = requestDashboardAttention();
                navigate(`/finance?${params.toString()}`, { replace: true });
                window.setTimeout(() => {
                    stopAttention();
                }, 15000);
            } catch (error) {
                console.error('Dashboard handoff poll error:', error);
            } finally {
                busy = false;
            }
        };

        void claimDashboardHandoff();
        const timer = window.setInterval(() => {
            void claimDashboardHandoff();
        }, DASHBOARD_HANDOFF_POLL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [navigate]);

    return (
        <div className="app-layout">
            <Sidebar />
            <main className="main-content">
                <Outlet />
            </main>
        </div>
    );
};

export default Layout;
