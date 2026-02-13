import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');
const SERVER_DIR = join(ROOT, 'server');
const STRICT = process.argv.includes('--strict');

const normalize = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '/';
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeading.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
};

const patternToRegex = (pattern) => {
    const normalized = normalize(pattern);
    const placeholderToken = '__DYNAMIC_SEGMENT__';
    const withTokens = normalized.replace(/:[A-Za-z0-9_]+/g, placeholderToken);
    const escaped = withTokens.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replaceAll(placeholderToken, '[^/]+')}$`);
};

const walk = async (dir, allowedExt = ['.js', '.jsx']) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await walk(full, allowedExt));
            continue;
        }
        if (allowedExt.some((ext) => entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
};

const extractFrontendApiPaths = async () => {
    const files = await walk(SRC_DIR);
    const endpoints = new Set();
    const apiUrlPattern = /\$\{API_URL\}([^`'"]+)/g;

    for (const file of files) {
        const raw = await readFile(file, 'utf8');
        let match = apiUrlPattern.exec(raw);
        while (match) {
            const expr = String(match[1] || '');
            const noTemplates = expr.replace(/\$\{[^}]+\}/g, ':param');
            const pathOnly = noTemplates.split('?')[0];
            if (pathOnly.startsWith('/')) {
                endpoints.add(normalize(pathOnly));
            }
            match = apiUrlPattern.exec(raw);
        }
    }
    return [...endpoints].sort();
};

const parseRouteMethods = (source) => {
    const routes = [];
    const routePattern = /(router|app)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
    let match = routePattern.exec(source);
    while (match) {
        routes.push({
            scope: match[1],
            method: match[2].toUpperCase(),
            path: normalize(match[3])
        });
        match = routePattern.exec(source);
    }
    return routes;
};

const buildServerApiPatterns = async () => {
    const indexPath = join(SERVER_DIR, 'index.js');
    const indexRaw = await readFile(indexPath, 'utf8');
    const patterns = new Set();

    const routeImports = new Map();
    const importPattern = /import\s+([A-Za-z0-9_]+)\s+from\s+['"]\.\/routes\/([^'"]+)['"]/g;
    let importMatch = importPattern.exec(indexRaw);
    while (importMatch) {
        routeImports.set(importMatch[1], importMatch[2]);
        importMatch = importPattern.exec(indexRaw);
    }

    const mounts = new Map();
    const useWithMountPattern = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
    let mountMatch = useWithMountPattern.exec(indexRaw);
    while (mountMatch) {
        const mount = normalize(mountMatch[1]);
        const varName = mountMatch[2];
        const current = mounts.get(varName) || [];
        current.push(mount);
        mounts.set(varName, current);
        mountMatch = useWithMountPattern.exec(indexRaw);
    }

    const useDirectPattern = /app\.use\(\s*([A-Za-z0-9_]+)\s*\)/g;
    let directMatch = useDirectPattern.exec(indexRaw);
    while (directMatch) {
        const varName = directMatch[1];
        const current = mounts.get(varName) || [];
        current.push('');
        mounts.set(varName, current);
        directMatch = useDirectPattern.exec(indexRaw);
    }

    // Include direct app routes from index.js
    parseRouteMethods(indexRaw)
        .filter((entry) => entry.scope === 'app')
        .forEach((entry) => {
            if (entry.path.startsWith('/api')) {
                patterns.add(normalize(entry.path.slice(4) || '/'));
            }
        });

    for (const [varName, importRel] of routeImports.entries()) {
        const relFile = importRel.endsWith('.js') ? importRel : `${importRel}.js`;
        const filePath = resolve(SERVER_DIR, 'routes', relFile);
        const source = await readFile(filePath, 'utf8');
        const routerRoutes = parseRouteMethods(source).filter((entry) => entry.scope === 'router');
        const mountPoints = mounts.get(varName) || ['/api'];

        for (const mount of mountPoints) {
            for (const route of routerRoutes) {
                if (!mount) {
                    if (route.path.startsWith('/api')) {
                        patterns.add(normalize(route.path.slice(4) || '/'));
                    }
                    continue;
                }

                if (!mount.startsWith('/api')) continue;
                const apiBase = normalize(mount.slice(4) || '/');
                patterns.add(normalize(`${apiBase}${route.path}`));
            }
        }
    }

    return [...patterns].sort();
};

const run = async () => {
    const frontendPaths = await extractFrontendApiPaths();
    const serverPatterns = await buildServerApiPatterns();
    const serverRegex = serverPatterns.map((pattern) => ({ pattern, regex: patternToRegex(pattern) }));

    const missing = frontendPaths.filter((path) => !serverRegex.some((entry) => entry.regex.test(path)));

    console.log(`[contracts] Frontend API paths: ${frontendPaths.length}`);
    console.log(`[contracts] Server API patterns: ${serverPatterns.length}`);

    if (missing.length > 0) {
        console.log('[contracts] Missing backend matches for frontend paths:');
        missing.forEach((path) => console.log(` - ${path}`));
    } else {
        console.log('[contracts] No missing paths found.');
    }

    if (STRICT && missing.length > 0) {
        process.exitCode = 1;
    }
};

run().catch((error) => {
    console.error('[contracts] Failed:', error);
    process.exitCode = 1;
});
