import pdf from 'pdf-parse';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import xlsx from 'xlsx';

const execFileAsync = promisify(execFile);

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeText = (value) => compactWhitespace(value).toLowerCase();

const extractEmailDomains = (value) => {
    const text = String(value || '').toLowerCase();
    const matches = [...text.matchAll(/\b[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})\b/g)];
    return Array.from(new Set(matches.map((m) => m[1]).filter(Boolean)));
};
const extractHeaderValue = (text, headerName) => {
    const pattern = new RegExp(`(?:^|\\n)\\s*${headerName}\\s*:\\s*([^\\n]+)`, 'i');
    const match = String(text || '').match(pattern);
    return compactWhitespace(match?.[1] || '');
};

const extractFromHeaderDomains = (value) => {
    const fromValue = extractHeaderValue(value, 'from');
    if (!fromValue) return [];
    return extractEmailDomains(fromValue);
};

const extractSubjectLine = (value) => extractHeaderValue(value, 'subject');

const GENERIC_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'outlook.com',
    'hotmail.com',
    'icloud.com',
    'aol.com'
]);

const parseSignatureTokens = (value) => String(value || '')
    .split(/[;,]+/g)
    .map((token) => compactWhitespace(token).toLowerCase())
    .filter(Boolean);

const priorityWeight = (value) => {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'high') return 1.3;
    if (token === 'medium') return 1;
    return 0.85;
};

const confidenceWeight = (value) => {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'high') return 1.25;
    if (token === 'medium') return 1;
    return 0.85;
};

const parseDomainPattern = (rawPattern) => {
    const token = String(rawPattern || '').toLowerCase().replace(/^from:\s*/, '').trim();
    if (!token) return null;
    if (token.includes('(forwarded)')) {
        return { type: 'generic', value: token };
    }

    // Common forms in the spreadsheet:
    // *@domain.com
    // user@domain.com
    // domain.com
    // *@sub.domain.com
    let domain = token;
    if (domain.includes('@')) {
        domain = domain.split('@').pop() || '';
    }
    domain = domain.replace(/^\*+\.?/, '').replace(/^\.+/, '').trim();
    if (!domain || !domain.includes('.')) return null;
    return { type: 'suffix', value: domain };
};

const loadVendorSignatures = () => {
    try {
        const workbook = xlsx.readFile(join(process.cwd(), 'vendor_signatures_final.xlsx'));
        const firstSheet = workbook.SheetNames?.[0];
        if (!firstSheet) return [];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
        return rows
            .map((row) => {
                const vendor = compactWhitespace(row?.Vendor || '');
                if (!vendor) return null;
                const domainPatterns = parseSignatureTokens(row?.['Domains / From Addresses'] || '')
                    .map(parseDomainPattern)
                    .filter(Boolean);
                const subjectTokens = parseSignatureTokens(row?.['Subject Identifiers'] || '');
                return {
                    vendor,
                    domainPatterns,
                    subjectTokens,
                    priority: priorityWeight(row?.['Detection Priority'] || ''),
                    confidence: confidenceWeight(row?.Confidence || '')
                };
            })
            .filter(Boolean);
    } catch {
        return [];
    }
};

const VENDOR_SIGNATURES = loadVendorSignatures();

const DOMAIN_VENDOR_MAP = [
    { domain: 'socalgas.com', vendor: 'SoCalGas', score: 8 },
    { domain: 'spectrumemails.com', vendor: 'Spectrum Business', score: 8 },
    { domain: 'amwater.com', vendor: 'California American Water', score: 8 },
    { domain: 'hammerpestcontrol.com', vendor: 'Hammer Pest Control', score: 8 },
    { domain: 'aramsco.com', vendor: 'Aramsco', score: 8 },
    { domain: 'esp-cpa.com', vendor: 'ESP Accounting', score: 8 },
    { domain: 'americanfirstresponder.com', vendor: 'American First Responder', score: 8 },
    { domain: 'zoom.us', vendor: 'Zoom', score: 8 },
    { domain: 'amazon.com', vendor: 'Amazon', score: 8 },
    { domain: 'staples.com', vendor: 'Staples', score: 8 },
    { domain: 'staplesadvantage.com', vendor: 'Staples', score: 8 },
    { domain: 'techsoup.org', vendor: 'TechSoup', score: 8 },
    { domain: 'networksolutions.com', vendor: 'Network Solutions', score: 8 }
];

const CONTENT_RULES = [
    { vendor: 'SoCalGas', patterns: [/\bsocalgas\b/i, /customerservice@socalgas\.com/i] },
    { vendor: 'Spectrum Business', patterns: [/\bspectrum business\b/i, /@spectrumemails\.com/i] },
    { vendor: 'California American Water', patterns: [/\bcalifornia american water\b/i, /\bamerican water\b/i, /\bcal am water\b/i] },
    { vendor: 'Hammer Pest Control', patterns: [/\bhammer pest control\b/i, /@hammerpestcontrol\.com/i] },
    { vendor: 'Aramsco', patterns: [/\baramsco\b/i] },
    { vendor: 'ESP Accounting', patterns: [/\besp accounting\b/i, /@esp-cpa\.com/i] },
    { vendor: 'American First Responder', patterns: [/\bamerican first responder\b/i, /@americanfirstresponder\.com/i] },
    { vendor: 'Zoom', patterns: [/\bzoom account renewal\b/i, /\bbilling@zoom\.us\b/i, /\bzoom\.us\b/i] },
    { vendor: 'Amazon', patterns: [/\bamazon\.com\b/i, /\bauto-confirm@amazon\.com\b/i] },
    { vendor: 'Staples', patterns: [/\bstaples\b/i, /@staples(?:advantage)?\.com/i] },
    { vendor: 'TechSoup', patterns: [/\btechsoup\b/i, /@e\.techsoup\.org/i] },
    { vendor: 'Network Solutions', patterns: [/\bnetwork solutions\b/i] }
];
const STRONG_VENDOR_PATTERNS = [
    { vendor: 'Amazon', patterns: [/\bamazon order\b/i, /\bamazon\.com\b/i, /@amazon\.com/i, /\bsold by amazon\b/i] },
    { vendor: 'Staples', patterns: [/\bstaples(?:\.com)?\b/i, /@staples(?:advantage)?\.com/i] }
];

const scoreFromDomainHints = (text) => {
    const domains = extractEmailDomains(text);
    const fromDomains = extractFromHeaderDomains(text);
    const scores = new Map();
    const add = (vendor, amount) => scores.set(vendor, (scores.get(vendor) || 0) + amount);
    for (const domain of domains) {
        for (const hint of DOMAIN_VENDOR_MAP) {
            if (!domain.endsWith(hint.domain)) continue;
            add(hint.vendor, hint.score);
        }
    }
    // From-header sender domain is a strong signal and should dominate generic token hits.
    for (const domain of fromDomains) {
        for (const hint of DOMAIN_VENDOR_MAP) {
            if (!domain.endsWith(hint.domain)) continue;
            add(hint.vendor, hint.score + 12);
        }
    }
    return scores;
};

const scoreFromVendorSignatures = (text) => {
    if (!VENDOR_SIGNATURES.length) return new Map();
    const scores = new Map();
    const normalized = normalizeText(text);
    const domains = extractEmailDomains(normalized);
    for (const signature of VENDOR_SIGNATURES) {
        let domainHit = 0;
        let subjectHit = 0;

        for (const matcher of signature.domainPatterns) {
            if (matcher?.type !== 'suffix' || !matcher.value) continue;
            const suffix = matcher.value;
            const matched = domains.some((domain) => domain === suffix || domain.endsWith(`.${suffix}`));
            if (!matched) continue;
            const generic = GENERIC_EMAIL_DOMAINS.has(suffix);
            domainHit += generic ? 1 : 3;
        }

        for (const token of signature.subjectTokens) {
            if (!token) continue;
            if (normalized.includes(token)) subjectHit += 1;
        }

        // Guardrail: avoid over-matching generic domains (gmail/outlook/etc) unless subject aligns.
        const hasOnlyGenericDomain = domainHit > 0
            && signature.domainPatterns.every((pattern) => pattern?.type !== 'suffix' || GENERIC_EMAIL_DOMAINS.has(pattern.value));
        if (hasOnlyGenericDomain && subjectHit === 0) {
            continue;
        }

        if (domainHit === 0 && subjectHit === 0) continue;
        const weighted = Math.min(
            18,
            Math.round(((domainHit * 7) + (subjectHit * 5)) * signature.priority * signature.confidence)
        );
        if (weighted <= 0) continue;
        scores.set(signature.vendor, (scores.get(signature.vendor) || 0) + weighted);
    }
    return scores;
};

const scoreFromContentRules = (text) => {
    const scores = new Map();
    const subject = extractSubjectLine(text);
    const normalized = normalizeText(text);
    for (const rule of CONTENT_RULES) {
        let subjectHits = 0;
        let bodyHits = 0;
        for (const pattern of rule.patterns) {
            if (pattern.test(subject)) subjectHits += 1;
            if (pattern.test(normalized)) bodyHits += 1;
        }
        const score = (subjectHits * 6) + (bodyHits * 3);
        if (score > 0) {
            scores.set(rule.vendor, (scores.get(rule.vendor) || 0) + score);
        }
    }
    return scores;
};

const scoreFromStrongPatterns = (text) => {
    const scores = new Map();
    const subject = extractSubjectLine(text);
    const normalized = normalizeText(text);
    for (const rule of STRONG_VENDOR_PATTERNS) {
        let hits = 0;
        for (const pattern of rule.patterns) {
            if (pattern.test(subject)) hits += 2;
            if (pattern.test(normalized)) hits += 1;
        }
        if (hits > 0) {
            scores.set(rule.vendor, (scores.get(rule.vendor) || 0) + (hits * 5));
        }
    }
    return scores;
};

const mergeScores = (...maps) => {
    const merged = new Map();
    for (const map of maps) {
        for (const [key, value] of map.entries()) {
            merged.set(key, (merged.get(key) || 0) + value);
        }
    }
    return merged;
};

const MIN_VENDOR_MATCH_SCORE = 10;

const commandExists = async (command) => {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    try {
        await execFileAsync(checker, [command], { windowsHide: true });
        return true;
    } catch {
        return false;
    }
};

const runCommand = async (command, args) => {
    const result = await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024
    });
    return String(result?.stdout || '');
};

const extractVendorViaOcr = async (pdfPath) => {
    const hasPpm = await commandExists('pdftoppm');
    const hasTesseract = await commandExists('tesseract');
    if (!hasPpm || !hasTesseract) {
        return { vendor: '', confidence: 0, method: 'ocr-unavailable', candidates: [] };
    }

    const tempDir = join(tmpdir(), `ap-vendor-ocr-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    try {
        const prefix = join(tempDir, 'page1');
        await runCommand('pdftoppm', ['-png', '-singlefile', '-f', '1', '-r', '220', pdfPath, prefix]);
        const imagePath = `${prefix}.png`;
        let ocrText = '';
        try {
            ocrText = await runCommand('tesseract', [imagePath, 'stdout', '--psm', '6']);
        } catch {
            ocrText = await runCommand('tesseract', [imagePath, 'stdout', '--psm', '11']);
        }
        return extractVendorFromPdfText(ocrText);
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
};

const pickTopVendor = (scores) => {
    const ranked = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) {
        return { vendor: '', confidence: 0, candidates: [] };
    }
    const [vendor, score] = ranked[0];
    const secondScore = Number(ranked[1]?.[1] || 0);
    const total = ranked.reduce((sum, [, s]) => sum + s, 0) || score;
    const margin = Math.max(0, score - secondScore);
    const confidence = Math.max(0.1, Math.min(0.99, (score + margin) / (total + 1)));
    return {
        vendor,
        confidence,
        margin,
        candidates: ranked.map(([name, s]) => ({ vendor: name, score: s }))
    };
};

export const extractVendorFromPdfText = (text) => {
    const rawText = String(text || '');
    const normalized = normalizeText(rawText);
    if (!normalized) {
        return { vendor: '', confidence: 0, method: 'empty-text', candidates: [] };
    }
    const signatureScores = scoreFromVendorSignatures(rawText);
    const domainScores = scoreFromDomainHints(rawText);
    const contentScores = scoreFromContentRules(rawText);
    const strongPatternScores = scoreFromStrongPatterns(rawText);
    const merged = mergeScores(signatureScores, domainScores, contentScores, strongPatternScores);
    const best = pickTopVendor(merged);
    const topScore = Number(best?.candidates?.[0]?.score || 0);
    const secondScore = Number(best?.candidates?.[1]?.score || 0);
    const ambiguous = best.vendor && topScore >= MIN_VENDOR_MATCH_SCORE && (topScore - secondScore) < 3 && topScore < 24;
    if (!best.vendor || topScore < MIN_VENDOR_MATCH_SCORE || ambiguous) {
        return {
            vendor: '',
            confidence: 0,
            method: ambiguous ? 'ambiguous-match' : 'no-match',
            candidates: best.candidates
        };
    }
    return {
        vendor: best.vendor,
        confidence: best.confidence,
        method: 'combined-signals',
        candidates: best.candidates
    };
};

export const extractVendorFromPdfBytes = async (pdfBytes, options = {}) => {
    const sourcePdfPath = String(options?.sourcePdfPath || '').trim();
    const parsed = await pdf(Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes || ''));
    const text = compactWhitespace(parsed?.text || '');
    const fromText = extractVendorFromPdfText(text);
    if (fromText.vendor) {
        return {
            ...fromText,
            textLength: text.length
        };
    }

    // Fallback: inspect raw bytes for embedded strings if text extraction is low quality.
    const rawText = String(Buffer.isBuffer(pdfBytes) ? pdfBytes.toString('latin1') : '');
    const fallback = extractVendorFromPdfText(rawText);
    const fromRaw = {
        ...fallback,
        method: fallback.vendor ? 'raw-bytes-fallback' : fromText.method,
        textLength: text.length
    };
    if (fromRaw.vendor || !sourcePdfPath) return fromRaw;

    const fromOcr = await extractVendorViaOcr(sourcePdfPath);
    return {
        ...fromOcr,
        textLength: text.length
    };
};

export const __TEST__ = {
    extractVendorFromPdfText
};
