import { ROUTE_MANIFEST } from './routeManifest';

const routeEntries = ROUTE_MANIFEST.reduce((acc, entry) => {
    acc[entry.key] = entry.path;
    return acc;
}, {});

export const APP_ROUTES = Object.freeze(routeEntries);

export const getOriginRoute = ({ originType, originId = '', taskId = '' } = {}) => {
    const type = String(originType || '').trim().toLowerCase();
    if (!type) return '';

    if (type === 'sunday') {
        const params = new URLSearchParams();
        if (originId) params.set('date', originId);
        if (taskId) params.set('task', taskId);
        const query = params.toString();
        return `${APP_ROUTES.sunday}${query ? `?${query}` : ''}`;
    }

    if (type === 'vestry') return APP_ROUTES.vestry;
    if (type === 'event') return APP_ROUTES.calendar;

    if (type === 'ticket') {
        const query = originId ? `?ticket=${encodeURIComponent(originId)}` : '';
        return `${APP_ROUTES.buildings}${query}`;
    }

    if (type === 'operations') return APP_ROUTES.todo;

    return '';
};
