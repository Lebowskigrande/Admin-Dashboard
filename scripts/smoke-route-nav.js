import { ROUTE_MANIFEST } from '../src/config/routeManifest.js';

const STRICT = process.argv.includes('--strict');

const run = async () => {
    const appRoutes = ROUTE_MANIFEST.map((entry) => entry.path);
    const navPaths = ROUTE_MANIFEST.filter((entry) => entry.showInNav).map((entry) => entry.path);
    const routeSet = new Set(appRoutes);
    const navSet = new Set(navPaths);
    const duplicateRoutes = appRoutes.filter((path, index) => appRoutes.indexOf(path) !== index);
    const invalidEntries = ROUTE_MANIFEST
        .filter((entry) => entry.path !== '/' && !entry.routePath)
        .map((entry) => entry.key);

    const hiddenRoutes = appRoutes
        .filter((route) => !navSet.has(route))
        .filter((route) => ROUTE_MANIFEST.find((entry) => entry.path === route)?.showInNav)
        .sort();

    const orphanNav = navPaths
        .filter((route) => !routeSet.has(route))
        .sort();

    console.log(`[smoke:routes] App routes: ${appRoutes.length}`);
    console.log(`[smoke:routes] Sidebar links: ${navPaths.length}`);

    if (hiddenRoutes.length > 0) {
        console.log('[smoke:routes] Routes not present in sidebar:');
        hiddenRoutes.forEach((route) => console.log(` - ${route}`));
    }
    if (orphanNav.length > 0) {
        console.log('[smoke:routes] Sidebar routes missing in app router:');
        orphanNav.forEach((route) => console.log(` - ${route}`));
    }
    if (duplicateRoutes.length > 0) {
        console.log('[smoke:routes] Duplicate route paths in manifest:');
        duplicateRoutes.forEach((route) => console.log(` - ${route}`));
    }
    if (invalidEntries.length > 0) {
        console.log('[smoke:routes] Manifest entries missing routePath:');
        invalidEntries.forEach((key) => console.log(` - ${key}`));
    }
    if (hiddenRoutes.length === 0 && orphanNav.length === 0 && duplicateRoutes.length === 0 && invalidEntries.length === 0) {
        console.log('[smoke:routes] Route/navigation alignment OK.');
    }

    if (STRICT && (hiddenRoutes.length > 0 || orphanNav.length > 0 || duplicateRoutes.length > 0 || invalidEntries.length > 0)) {
        process.exitCode = 1;
    }
};

run().catch((error) => {
    console.error('[smoke:routes] Failed:', error);
    process.exitCode = 1;
});
