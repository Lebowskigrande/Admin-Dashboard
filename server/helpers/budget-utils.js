import { access, readFile, readdir, stat } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';
import xlsx from 'xlsx';
import pdf from 'pdf-parse';
import { PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib';

export const DEFAULT_BUDGET_REPORT_PATH = resolve(process.cwd(), 'church budget vs actuals.pdf');

const transactionPdfCache = new Map();

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const buildLookupKey = (value) => normalizeText(value).replace(/\s+/g, ' ');

const formatDateKey = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
};

const parseCurrencyToken = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw === '-') return null;
    const negative = raw.startsWith('(') && raw.endsWith(')');
    const cleaned = raw.replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return negative ? -Math.abs(parsed) : parsed;
};

const parsePercentToken = (value) => {
    const cleaned = String(value || '').trim().replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
};

const unique = (values = []) => {
    const seen = new Set();
    const ordered = [];
    values.forEach((value) => {
        const key = String(value || '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        ordered.push(key);
    });
    return ordered;
};

export const loadBudgetCodes = () => {
    const filePath = resolve(process.cwd(), 'budget_codes.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const entries = [];
    let currentCategory = '';

    rows.forEach((row) => {
        const category = String(row[0] || '').trim();
        const codeRaw = String(row[1] || '').trim();
        const line = String(row[2] || '').trim();

        if (category) {
            currentCategory = category;
        }
        if (!currentCategory) return;
        if (line.toLowerCase() === 'div') return;

        if (!codeRaw) {
            if (line) {
                entries.push({ type: 'heading', category: currentCategory, label: line });
            }
            return;
        }

        entries.push({
            type: 'item',
            category: currentCategory,
            code: codeRaw,
            line
        });
    });

    return entries;
};

const normalizeBudgetReportText = (text) => {
    return String(text || '')
        .replace(/\r/g, '')
        .replace(/([A-Za-z])\n(?=[A-Za-z])/g, '$1')
        .replace(/([A-Za-z%])(\d)/g, '$1 $2')
        .replace(/([A-Za-z)])(-)(?=(?:\(|\d|-|\s))/g, '$1 $2')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
};

export const parseBudgetSnapshotReport = async (pdfPath = DEFAULT_BUDGET_REPORT_PATH) => {
    const resolvedPath = resolve(pdfPath);
    const bytes = await readFile(resolvedPath);
    const parsed = await pdf(bytes);
    const rawText = String(parsed?.text || '');
    const normalized = normalizeBudgetReportText(rawText);
    const dateMatch = normalized.match(/For the year-to-date ended ([A-Za-z]+ \d{1,2}, \d{4}) \((\d+)% of the year\)/i);
    const statementDate = dateMatch?.[1] ? new Date(dateMatch[1]) : null;
    const percentOfYear = dateMatch?.[2] ? Number.parseInt(dateMatch[2], 10) : null;

    const rawLines = rawText
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean);

    const reportLines = [];
    for (let index = 0; index < rawLines.length; index += 1) {
        let line = rawLines[index];
        if (/^(ASSETS|Balance Sheet)\b/i.test(line)) break;
        if (/^[A-Za-z&'/.()-]$/.test(line) && rawLines[index + 1]) {
            line = `${line}${rawLines[index + 1]}`;
            index += 1;
        }
        if (
            /^(St\. Edmund's Episcopal Church|Operating Budget vs\. Actual)$/i.test(line)
            || /^For the year-to-date ended /i.test(line)
            || /^These financial statements are prepared /i.test(line)
            || /^for all accounts /i.test(line)
            || /^have not been subjected /i.test(line)
            || /^Page \d+ of \d+$/i.test(line)
            || /^(Operating|\(YTD\)|SENS Contr|Actual \(YTD\)|Budget|\(Annual\)|% of|Budget)$/i.test(line)
        ) {
            continue;
        }
        reportLines.push(line);
    }

    const lines = [];
    for (let index = 0; index < reportLines.length; index += 1) {
        const current = reportLines[index];
        const next = reportLines[index + 1];
        if (/^\d+%$/.test(next || '')) {
            lines.push(`${current} ${next}`);
            index += 1;
            continue;
        }
        lines.push(current);
    }

    const rowRegex = /^(?<label>.*?)(?<operating>-|\(?-?[\d,]+(?:\.\d{2})?\)?)\s+(?<sens>-|\(?-?[\d,]+(?:\.\d{2})?\)?)\s+(?<actual>-|\(?-?[\d,]+(?:\.\d{2})?\)?)\s+(?<budget>-|\(?-?[\d,]+(?:\.\d{2})?\)?)\s+(?<percent>\d+)%$/;
    const ignoredLabels = new Set([
        'Income',
        'Expenses',
        'Other Income',
        'Other Expenses',
        'Fundraising Income, net',
        'Ministry Expenses',
        'Communications Expenses',
        'Facility Expenses',
        'Administrative Expenses',
        'Personnel Expenses',
        'St. Edmund\'s Episcopal Church',
        'Operating Budget vs. Actual'
    ]);

    const budgetLines = [];
    lines.forEach((line) => {
        const match = line.match(rowRegex);
        if (!match?.groups) return;
        const label = String(match.groups.label || '').trim();
        if (!label || ignoredLabels.has(label)) return;
        const annualBudget = parseCurrencyToken(match.groups.budget);
        const actualYtd = parseCurrencyToken(match.groups.actual);
        const operatingYtd = parseCurrencyToken(match.groups.operating);
        const sensContributionYtd = parseCurrencyToken(match.groups.sens);
        const percentUsed = parsePercentToken(match.groups.percent);
        if (
            annualBudget == null
            && actualYtd == null
            && operatingYtd == null
            && sensContributionYtd == null
        ) {
            return;
        }
        budgetLines.push({
            label,
            operatingYtd,
            sensContributionYtd,
            actualYtd,
            annualBudget,
            percentUsed,
            isTotal: /^total\b/i.test(label) || /^net\b/i.test(label)
        });
    });

    const totals = budgetLines.reduce((acc, line) => {
        if (line.isTotal) return acc;
        if (Number.isFinite(line.annualBudget)) acc.annualBudget += line.annualBudget;
        if (Number.isFinite(line.actualYtd)) acc.actualYtd += line.actualYtd;
        return acc;
    }, { annualBudget: 0, actualYtd: 0 });

    return {
        pdfPath: resolvedPath,
        statementDate: statementDate && !Number.isNaN(statementDate.getTime()) ? statementDate.toISOString() : '',
        statementDateLabel: statementDate && !Number.isNaN(statementDate.getTime()) ? statementDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : '',
        reportYear: statementDate && !Number.isNaN(statementDate.getTime()) ? statementDate.getFullYear() : null,
        percentOfYear,
        annualBudgetTotal: totals.annualBudget,
        actualYtdTotal: totals.actualYtd,
        lines: budgetLines
    };
};

const CODE_BUCKET_ALIASES = {
    '7130': ['Rector\'s Compensation'],
    '7110': ['Rector\'s Compensation'],
    '7120': ['Rector\'s Compensation'],
    '7115': ['Rector\'s Compensation'],
    '7210': ['Assoc Rector\'s Compensation'],
    '7215': ['Assoc Rector\'s Compensation'],
    '7220': ['Assoc Rector\'s Compensation'],
    '7230': ['Assoc Rector\'s Compensation'],
    '7410': ['Lay Staff Compensation'],
    '7690': ['Lay Staff Compensation'],
    '7460': ['Lay Staff Compensation'],
    '7420': ['Lay Staff Compensation'],
    '7470': ['Lay Staff Compensation'],
    '7590': ['Lay Staff Compensation'],
    '7510': ['Lay Staff Compensation'],
    '7520': ['Lay Staff Compensation'],
    '7530': ['Lay Staff Compensation'],
    '7310': ['Contracted Labor'],
    '7320': ['Contracted Labor'],
    '7180': ['Other Staff Expenses'],
    '7190': ['Other Staff Expenses'],
    '8100': ['Diocesan Pledge'],
    '7625': ['Music Ministry'],
    '7620': ['Music Ministry'],
    '8280': ['Music Ministry'],
    '8330': ['Worship Ministry'],
    '8380': ['Worship Ministry'],
    '8350': ['Worship Ministry'],
    '8490': ['Outreach Ministry'],
    '8480': ['Outreach Ministry'],
    '8670': ['Outreach Ministry'],
    '8612': ['Outreach Ministry'],
    '8510': ['Hospitality & Fellowship'],
    '8520': ['Hospitality & Fellowship'],
    '8660': ['Christian Education'],
    '8640': ['Christian Education'],
    '8820': ['Custodial'],
    '8810': ['B&G Repairs & Maintenance'],
    '8840': ['HVAC Maintenance'],
    '8830': ['Landscaping'],
    '8845': ['Lighting Maintenance'],
    '8835': ['Pest Control'],
    '8860': ['B&G Supplies'],
    '8865': ['Safety & Security'],
    '8891': ['Utilities'],
    '8892': ['Utilities'],
    '8893': ['Utilities'],
    '8894': ['Utilities'],
    '8895': ['Utilities'],
    '8880': ['Safety & Security'],
    '8870': ['Prop & Liab Insurance'],
    '8875': ['Property Taxes'],
    '8770': ['Other Communications Expense', 'Total Communications Expenses'],
    '8750': ['Advertising'],
    '8710': ['Copier Lease'],
    '8930': ['Supplies & Software'],
    '8940': ['Supplies & Software'],
    '8920': ['Supplies & Software'],
    '8720': ['Supplies & Software'],
    '8730': ['Supplies & Software'],
    '7695': ['Audit'],
    '8995': ['Fees & Charges'],
    '8990': ['Fees & Charges'],
    '9910': ['Interest Expense / Term Loan']
};

const LINE_BUCKET_ALIASES = {
    'assoc rector salary': ['Assoc Rector\'s Compensation'],
    'assoc rector sal sens reimb': ['Assoc Rector\'s Compensation'],
    'assoc rector insurance': ['Assoc Rector\'s Compensation'],
    'pension assoc rector': ['Assoc Rector\'s Compensation'],
    'salary hourly wages': ['Lay Staff Compensation'],
    'bookkeeper salary': ['Lay Staff Compensation'],
    'chihldrens ministry salaries': ['Lay Staff Compensation'],
    'organist salary': ['Lay Staff Compensation'],
    'videographer salary': ['Lay Staff Compensation'],
    'workers comp insurance': ['Lay Staff Compensation'],
    'payrolltxs': ['Lay Staff Compensation'],
    'music choir exps': ['Music Ministry'],
    'sub organist': ['Music Ministry'],
    'piano organ maintenance': ['Music Ministry'],
    'adult formation': ['Christian Education'],
    'children youth ministry expense': ['Christian Education'],
    'edify expenses': ['Christian Education'],
    'good works partners outreach': ['Outreach Ministry'],
    'good works partners pose rf': ['Outreach Ministry'],
    'inspiring voices speaker series': ['Outreach Ministry'],
    'assoc rector disc expense': ['Outreach Ministry'],
    'hospitality supplies': ['Hospitality & Fellowship'],
    'event hospitality': ['Hospitality & Fellowship'],
    'altar supplies': ['Worship Ministry'],
    'church supplies': ['Worship Ministry'],
    'altar guild flowers': ['Worship Ministry'],
    'custodial': ['Custodial'],
    'floor maintenance': ['B&G Repairs & Maintenance'],
    'repairs maintenance not capex': ['B&G Repairs & Maintenance'],
    'hvac maintenance': ['HVAC Maintenance'],
    'landscaping': ['Landscaping'],
    'lighting maintenance contract': ['Lighting Maintenance'],
    'pest termite control': ['Pest Control'],
    'b g supplies': ['B&G Supplies'],
    'door locks': ['Safety & Security'],
    'safety and preparedness': ['Safety & Security'],
    'interest expense term loan': ['Interest Expense / Term Loan'],
    'electricity': ['Utilities'],
    'gas': ['Utilities'],
    'telephone office 555': ['Utilities'],
    'water': ['Utilities'],
    'security system et al': ['Safety & Security'],
    'internet connectivity': ['Utilities'],
    'prop liab insurance': ['Prop & Liab Insurance'],
    'property taxes': ['Property Taxes'],
    'website development and maintenance': ['Other Communications Expense'],
    'advertising': ['Advertising'],
    'computer expense': ['Supplies & Software'],
    'computer expenses repairs minor hardware': ['Supplies & Software'],
    'copy postage machine lease': ['Copier Lease'],
    'dues subscriptions': ['Supplies & Software'],
    'office supplies': ['Supplies & Software'],
    'postage': ['Supplies & Software'],
    'printing': ['Supplies & Software'],
    'audit': ['Audit'],
    'banking charges': ['Fees & Charges'],
    'payroll processing fees': ['Fees & Charges'],
    'diocesan pledge': ['Diocesan Pledge']
};

const CATEGORY_BUCKET_ALIASES = {
    music: ['Music Ministry'],
    'christian education': ['Christian Education'],
    'outreach ministry': ['Outreach Ministry'],
    hospitality: ['Hospitality & Fellowship'],
    'worship ministry': ['Worship Ministry']
};

const resolveBucketLabel = (candidate, bucketLookup) => {
    if (!candidate) return '';
    const direct = bucketLookup.get(buildLookupKey(candidate));
    return direct?.label || '';
};

export const mapBudgetEntriesToBuckets = (budgetEntries = [], snapshot = {}) => {
    const bucketLookup = new Map(
        (Array.isArray(snapshot?.lines) ? snapshot.lines : []).map((line) => [buildLookupKey(line.label), line])
    );

    return budgetEntries.map((entry) => {
        if (String(entry?.type || '').toLowerCase() !== 'item') return entry;
        const candidates = unique([
            ...(LINE_BUCKET_ALIASES[buildLookupKey(entry.line)] || []),
            ...(CODE_BUCKET_ALIASES[String(entry.code || '').trim()] || []),
            ...(CATEGORY_BUCKET_ALIASES[buildLookupKey(entry.category)] || [])
        ]);

        let bucketLabel = '';
        for (const candidate of candidates) {
            bucketLabel = resolveBucketLabel(candidate, bucketLookup);
            if (bucketLabel) break;
        }

        if (!bucketLabel) {
            bucketLabel = resolveBucketLabel(entry.line, bucketLookup);
        }

        const bucket = bucketLabel ? bucketLookup.get(buildLookupKey(bucketLabel)) : null;
        const mappingType = bucket
            ? (buildLookupKey(entry.line) === buildLookupKey(bucket.label) ? 'line' : 'group')
            : 'unmapped';

        return {
            ...entry,
            bucketLabel: bucket?.label || '',
            bucketMappingType: mappingType
        };
    });
};

export const buildCodeBucketMap = (budgetEntries = []) => {
    const bucketSets = new Map();
    budgetEntries.forEach((entry) => {
        if (!entry?.code || !entry?.bucketLabel) return;
        const code = String(entry.code || '').trim();
        if (!bucketSets.has(code)) bucketSets.set(code, new Set());
        bucketSets.get(code).add(entry.bucketLabel);
    });
    const mapping = new Map();
    bucketSets.forEach((labels, code) => {
        const values = Array.from(labels);
        mapping.set(code, {
            labels: values,
            bucketLabel: values.length === 1 ? values[0] : '',
            isAmbiguous: values.length > 1
        });
    });
    return mapping;
};

const extractBudgetCodeFromNoteText = (value) => {
    const match = String(value || '').match(/\bBudget code:\s*([A-Za-z0-9-]+)/i);
    return match?.[1] ? String(match[1]).trim() : '';
};

const extractPdfAnnotationNotes = async (bytes) => {
    const notes = [];
    const doc = await PDFDocument.load(bytes);
    const firstPage = doc.getPages()?.[0];
    const annots = firstPage?.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return notes;
    for (let i = 0; i < annots.size(); i += 1) {
        const annotRef = annots.get(i);
        const annot = doc.context.lookup(annotRef);
        const contents = annot?.get?.(PDFName.of('Contents'));
        let text = '';
        if (contents instanceof PDFString) text = contents.decodeText();
        else if (contents != null) text = String(contents || '');
        if (text) notes.push(text);
    }
    return notes;
};

const extractVendorFromFilename = (fileName) => {
    const base = String(fileName || '').replace(/\.pdf$/i, '').trim();
    const match = base.match(/^\d{4}\.\d{2}\s+SEEC\s+[A-Z]+\s+(.+)$/i);
    return match?.[1] ? match[1].replace(/-\d+$/, '').trim() : base;
};

const parseTransactionDate = ({ fileName = '', fallbackDate = '' } = {}) => {
    const match = String(fileName || '').match(/^(20\d{2})[.\-_](\d{2})/);
    if (match) {
        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
            return new Date(Date.UTC(year, month - 1, 1)).toISOString();
        }
    }
    const fallback = fallbackDate ? new Date(fallbackDate) : null;
    return fallback && !Number.isNaN(fallback.getTime()) ? fallback.toISOString() : '';
};

const chooseBestAmount = (text) => {
    const normalized = String(text || '').replace(/\s+/g, ' ');
    const labeledPatterns = [
        /\b(?:amount due|balance due|total due|invoice total|amount paid|total payment|payment amount|net amount)\b[^$0-9]{0,20}\$?\(?([0-9,]+(?:\.\d{2})?)\)?/gi,
        /\b(?:total|amt due)\b[^$0-9]{0,20}\$?\(?([0-9,]+(?:\.\d{2})?)\)?/gi
    ];
    const labeled = [];
    labeledPatterns.forEach((pattern, priority) => {
        for (const match of normalized.matchAll(pattern)) {
            const amount = parseCurrencyToken(match[1]);
            if (amount == null || amount <= 0) continue;
            labeled.push({ amount, priority, index: match.index || 0 });
        }
    });
    labeled.sort((a, b) => a.priority - b.priority || b.index - a.index || b.amount - a.amount);
    if (labeled[0]) return labeled[0].amount;

    const generalMatches = [...normalized.matchAll(/\$?\(?([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2}))\)?/g)]
        .map((match) => parseCurrencyToken(match[1]))
        .filter((amount) => amount != null && amount > 0 && amount < 100000);
    if (!generalMatches.length) return null;
    return Math.max(...generalMatches);
};

const parseBudgetTransactionPdf = async (filePath) => {
    const normalizedPath = resolve(filePath);
    const fileStats = await stat(normalizedPath);
    const cacheKey = `${normalizedPath}:${fileStats.mtimeMs}:${fileStats.size}`;
    const cached = transactionPdfCache.get(cacheKey);
    if (cached) return cached;

    const bytes = await readFile(normalizedPath);
    const [parsed, notes] = await Promise.all([
        pdf(bytes).catch(() => ({ text: '' })),
        extractPdfAnnotationNotes(bytes).catch(() => [])
    ]);
    const text = String(parsed?.text || '');
    const noteText = notes.find((entry) => extractBudgetCodeFromNoteText(entry)) || notes[0] || '';
    const code = extractBudgetCodeFromNoteText(noteText) || extractBudgetCodeFromNoteText(text);
    const amount = chooseBestAmount(text);
    const payload = {
        noteText,
        code,
        amount,
        textSample: text.slice(0, 2000)
    };
    transactionPdfCache.clear();
    transactionPdfCache.set(cacheKey, payload);
    return payload;
};

const toTransactionRecord = ({
    id,
    sourceType,
    sourceLabel,
    sourcePath = '',
    filePath = '',
    fileName = '',
    code = '',
    vendor = '',
    amount = null,
    dateIso = '',
    bucketLabel = '',
    includedInSnapshot = false,
    exists = true,
    noteText = ''
} = {}) => ({
    id,
    sourceType,
    sourceLabel,
    sourcePath,
    filePath,
    fileName,
    code,
    vendor,
    amount: Number.isFinite(amount) ? amount : null,
    dateIso,
    dateKey: formatDateKey(dateIso),
    bucketLabel,
    includedInSnapshot,
    includedInCurrentActual: !includedInSnapshot,
    exists,
    noteText
});

export const collectBudgetTransactionsFromJobs = async ({
    rows = [],
    codeBucketMap = new Map(),
    snapshotDate = '',
    seenPaths = new Set()
} = {}) => {
    const transactions = [];
    const discoveredFolders = new Map();
    const snapshotTime = snapshotDate ? new Date(snapshotDate).getTime() : NaN;

    for (const row of rows) {
        const output = (() => {
            try {
                return JSON.parse(row.output_json || '{}');
            } catch {
                return {};
            }
        })();
        const files = Array.isArray(output?.files) ? output.files : [];
        const targetDir = String(output?.targetDir || '').trim();
        if (targetDir && !discoveredFolders.has(targetDir)) {
            discoveredFolders.set(targetDir, {
                id: `discovered:${targetDir}`,
                label: basename(targetDir) || targetDir,
                path: targetDir,
                enabled: true,
                sourceType: 'dashboard-folder'
            });
        }
        const code = String(row.code_value || '').trim();
        const bucketInfo = codeBucketMap.get(code) || { bucketLabel: '', isAmbiguous: false };
        const bucketLabel = bucketInfo.isAmbiguous ? '' : bucketInfo.bucketLabel;
        const rowDateIso = parseTransactionDate({
            fileName: files[0]?.name || '',
            fallbackDate: row.created_at
        });
        const rowTime = rowDateIso ? new Date(rowDateIso).getTime() : NaN;

        if (!files.length) {
            transactions.push(toTransactionRecord({
                id: row.id,
                sourceType: 'dashboard',
                sourceLabel: 'Dashboard routed expense',
                sourcePath: targetDir,
                fileName: '',
                code,
                vendor: String(output?.routing?.vendor || '').trim(),
                amount: null,
                dateIso: row.created_at,
                bucketLabel,
                includedInSnapshot: Number.isFinite(snapshotTime) && Number.isFinite(rowTime) && rowTime <= snapshotTime,
                exists: false,
                noteText: String(output?.routing?.noteText || '').trim()
            }));
            continue;
        }

        for (const [index, file] of files.entries()) {
            const filePath = String(file?.path || '').trim();
            const fileName = String(file?.name || basename(filePath) || '').trim();
            const resolvedDate = parseTransactionDate({ fileName, fallbackDate: row.created_at });
            const transactionTime = resolvedDate ? new Date(resolvedDate).getTime() : NaN;
            let parsed = { amount: null, code: '', noteText: '' };
            let exists = false;

            if (filePath) {
                try {
                    await access(filePath);
                    exists = true;
                    seenPaths.add(resolve(filePath));
                    parsed = await parseBudgetTransactionPdf(filePath);
                } catch {
                    exists = false;
                }
            }

            transactions.push(toTransactionRecord({
                id: `${row.id}:${index}`,
                sourceType: 'dashboard',
                sourceLabel: 'Dashboard routed expense',
                sourcePath: targetDir,
                filePath,
                fileName,
                code: parsed.code || code,
                vendor: String(output?.routing?.vendor || '').trim() || extractVendorFromFilename(fileName),
                amount: parsed.amount,
                dateIso: resolvedDate || row.created_at,
                bucketLabel,
                includedInSnapshot: Number.isFinite(snapshotTime) && Number.isFinite(transactionTime) && transactionTime <= snapshotTime,
                exists,
                noteText: parsed.noteText || String(output?.routing?.noteText || '').trim()
            }));
        }
    }

    return {
        transactions,
        discoveredFolders: Array.from(discoveredFolders.values()).sort((a, b) => a.label.localeCompare(b.label))
    };
};

const listPdfFilesRecursive = async (rootPath, depth = 0, collector = []) => {
    if (depth > 6 || collector.length >= 2500) return collector;
    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        if (collector.length >= 2500) break;
        const nextPath = join(rootPath, entry.name);
        if (entry.isDirectory()) {
            await listPdfFilesRecursive(nextPath, depth + 1, collector).catch(() => collector);
            continue;
        }
        if (entry.isFile() && extname(entry.name).toLowerCase() === '.pdf') {
            collector.push(nextPath);
        }
    }
    return collector;
};

export const scanBudgetSourceFolders = async ({
    sources = [],
    codeBucketMap = new Map(),
    snapshotDate = '',
    seenPaths = new Set(),
    reportYear = null
} = {}) => {
    const transactions = [];
    const snapshotTime = snapshotDate ? new Date(snapshotDate).getTime() : NaN;

    for (const source of sources) {
        const folderPath = resolve(String(source?.path || '').trim());
        if (!folderPath) continue;
        try {
            const folderStats = await stat(folderPath);
            if (!folderStats.isDirectory()) continue;
        } catch {
            continue;
        }

        const pdfFiles = await listPdfFilesRecursive(folderPath).catch(() => []);
        for (const pdfPath of pdfFiles) {
            const resolvedPath = resolve(pdfPath);
            if (seenPaths.has(resolvedPath)) continue;
            seenPaths.add(resolvedPath);

            const fileName = basename(resolvedPath);
            const fileStats = await stat(resolvedPath).catch(() => null);
            const dateIso = parseTransactionDate({ fileName, fallbackDate: fileStats?.mtime?.toISOString() || '' });
            const date = dateIso ? new Date(dateIso) : null;
            if (reportYear && date && !Number.isNaN(date.getTime()) && date.getUTCFullYear() !== reportYear) {
                continue;
            }

            let parsed = { code: '', amount: null, noteText: '' };
            try {
                parsed = await parseBudgetTransactionPdf(resolvedPath);
            } catch {
                parsed = { code: '', amount: null, noteText: '' };
            }

            const code = String(parsed.code || '').trim();
            if (!code) continue;
            const bucketInfo = codeBucketMap.get(code) || { bucketLabel: '', isAmbiguous: false };
            const bucketLabel = bucketInfo.isAmbiguous ? '' : bucketInfo.bucketLabel;
            const transactionTime = date ? date.getTime() : NaN;

            transactions.push(toTransactionRecord({
                id: `folder:${resolvedPath}`,
                sourceType: 'folder',
                sourceLabel: String(source?.label || basename(folderPath) || folderPath),
                sourcePath: folderPath,
                filePath: resolvedPath,
                fileName,
                code,
                vendor: extractVendorFromFilename(fileName),
                amount: parsed.amount,
                dateIso,
                bucketLabel,
                includedInSnapshot: Number.isFinite(snapshotTime) && Number.isFinite(transactionTime) && transactionTime <= snapshotTime,
                exists: true,
                noteText: parsed.noteText
            }));
        }
    }

    return transactions.sort((a, b) => String(b.dateIso || '').localeCompare(String(a.dateIso || '')));
};
