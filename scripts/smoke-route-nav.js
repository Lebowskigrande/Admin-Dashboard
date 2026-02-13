import { readFile } from 'fs/promises';
import { join } from 'path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const APP_PATH = join(ROOT, 'src', 'App.jsx');
const SIDEBAR_PATH = join(ROOT, 'src', 'components', 'Sidebar.jsx');
const NAV_ALLOWLIST = new Set(['/bulletins', '/communications']);

const normalize = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '/';
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeading.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
};

const parseAppRoutes = (raw) => {
    const routes = new Set(['/']);
    const routePattern = /<Route\s+path="([^"]+)"/g;
    let match = routePattern.exec(raw);
    while (match) {
        routes.add(normalize(match[1]));
        match = routePattern.exec(raw);
    }
    return routes;
};

const parseNavPaths = (raw) => {
    const paths = new Set();
    const pathPattern = /path:\s*'([^']+)'/g;
    let match = pathPattern.exec(raw);
    while (match) {
        paths.add(normalize(match[1]));
        match = pathPattern.exec(raw);
    }
    return paths;
};

const run = async () => {
    const appRaw = await readFile(APP_PATH, 'utf8');
    const sidebarRaw = await readFile(SIDEBAR_PATH, 'utf8');
    const appRoutes = parseAppRoutes(appRaw);
    const navPaths = parseNavPaths(sidebarRaw);

    const hiddenRoutes = [...appRoutes]
        .filter((route) => !navPaths.has(route))
        .filter((route) => !NAV_ALLOWLIST.has(route))
        .sort();

    const orphanNav = [...navPaths]
        .filter((route) => !appRoutes.has(route))
        .sort();

    console.log(`[smoke:routes] App routes: ${appRoutes.size}`);
    console.log(`[smoke:routes] Sidebar links: ${navPaths.size}`);

    if (hiddenRoutes.length > 0) {
        console.log('[smoke:routes] Routes not present in sidebar:');
        hiddenRoutes.forEach((route) => console.log(` - ${route}`));
    }
    if (orphanNav.length > 0) {
        console.log('[smoke:routes] Sidebar routes missing in app router:');
        orphanNav.forEach((route) => console.log(` - ${route}`));
    }
    if (hiddenRoutes.length === 0 && orphanNav.length === 0) {
        console.log('[smoke:routes] Route/navigation alignment OK.');
    }

    if (STRICT && (hiddenRoutes.length > 0 || orphanNav.length > 0)) {
        process.exitCode = 1;
    }
};

run().catch((error) => {
    console.error('[smoke:routes] Failed:', error);
    process.exitCode = 1;
});
