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

const readBalancedCall = (source, openParenIndex) => {
    let depth = 0;
    let quote = '';
    let escaped = false;

    for (let index = openParenIndex; index < source.length; index += 1) {
        const ch = source[index];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) {
                quote = '';
            }
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            continue;
        }
        if (ch === ')') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(openParenIndex + 1, index);
            }
        }
    }

    return '';
};

const splitTopLevelArgs = (argsSource) => {
    const args = [];
    let start = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = '';
    let escaped = false;

    for (let index = 0; index < argsSource.length; index += 1) {
        const ch = argsSource[index];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) {
                quote = '';
            }
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            continue;
        }

        if (ch === '(') {
            parenDepth += 1;
            continue;
        }
        if (ch === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (ch === '{') {
            braceDepth += 1;
            continue;
        }
        if (ch === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (ch === '[') {
            bracketDepth += 1;
            continue;
        }
        if (ch === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (ch === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            args.push(argsSource.slice(start, index).trim());
            start = index + 1;
        }
    }

    const tail = argsSource.slice(start).trim();
    if (tail) args.push(tail);
    return args;
};

const parseStringLiteral = (value) => {
    const trimmed = String(value || '').trim();
    const quote = trimmed[0];
    if (!quote || quote !== trimmed.at(-1) || !['"', '\'', '`'].includes(quote)) {
        return null;
    }
    return trimmed.slice(1, -1);
};

const extractAppUseMounts = (source) => {
    const mounts = [];
    const token = 'app.use(';
    let searchFrom = 0;

    while (searchFrom < source.length) {
        const start = source.indexOf(token, searchFrom);
        if (start === -1) break;

        const openParenIndex = start + token.length - 1;
        const argsSource = readBalancedCall(source, openParenIndex);
        if (!argsSource) {
            searchFrom = start + token.length;
            continue;
        }

        const args = splitTopLevelArgs(argsSource);
        const mountLiteral = parseStringLiteral(args[0]);
        const mount = mountLiteral == null ? '' : normalize(mountLiteral);
        const startIndex = mountLiteral == null ? 0 : 1;

        for (let index = startIndex; index < args.length; index += 1) {
            const candidate = String(args[index] || '').trim();
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)) {
                mounts.push({ mount, varName: candidate });
            }
        }

        searchFrom = openParenIndex + argsSource.length + 2;
    }

    return mounts;
};

const buildServerApiPatterns = async () => {
    const appPath = join(SERVER_DIR, 'app.js');
    const appRaw = await readFile(appPath, 'utf8');
    const patterns = new Set();

    const routeImports = new Map();
    const importPattern = /import\s+([A-Za-z0-9_]+)\s+from\s+['"]\.\/routes\/([^'"]+)['"]/g;
    let importMatch = importPattern.exec(appRaw);
    while (importMatch) {
        routeImports.set(importMatch[1], importMatch[2]);
        importMatch = importPattern.exec(appRaw);
    }

    const mounts = new Map();
    extractAppUseMounts(appRaw).forEach(({ mount, varName }) => {
        const current = mounts.get(varName) || [];
        current.push(mount);
        mounts.set(varName, current);
    });

    // Include direct app routes declared in app.js itself.
    parseRouteMethods(appRaw)
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
