import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

const extractJsonPayload = (stdout) => {
    const text = stdout.trim();
    if (!text) {
        throw new Error('OCR output missing JSON payload.');
    }

    const objects = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '{') {
            if (depth === 0) {
                start = i;
            }
            depth += 1;
        } else if (char === '}') {
            if (depth > 0) {
                depth -= 1;
                if (depth === 0 && start !== -1) {
                    objects.push(text.slice(start, i + 1));
                    start = -1;
                }
            }
        }
    }

    for (let i = objects.length - 1; i >= 0; i -= 1) {
        try {
            return JSON.parse(objects[i]);
        } catch {
            // Try earlier candidates.
        }
    }

    throw new Error('OCR output is not valid JSON.');
};

const runCommand = async (command, args, options = {}) => {
    try {
        const result = await execFileAsync(command, args, {
            maxBuffer: 50 * 1024 * 1024,
            ...options
        });
        return result.stdout?.toString() || '';
    } catch (error) {
        const message = error?.stderr?.toString() || error?.message || 'Command failed';
        throw new Error(`${command} ${args.join(' ')} failed: ${message}`);
    }
};

const ensureCommand = async (command) => {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    try {
        await execFileAsync(checker, [command]);
    } catch (error) {
        throw new Error(`Required command not found: ${command}`);
    }
};

const getTempDir = async () => {
    const dir = join(tmpdir(), `deposit-slip-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    return dir;
};

const DEFAULT_OCR_REGIONS = {
    micr: { xMin: 0.0, xMax: 1.0, yMin: 0.0, yMax: 0.14 },
    signature: { xMin: 0.56, xMax: 0.98, yMin: 0.12, yMax: 0.36 },
    memo: { xMin: 0.06, xMax: 0.52, yMin: 0.12, yMax: 0.3 },
    legalAmount: { xMin: 0.06, xMax: 0.9, yMin: 0.44, yMax: 0.61 },
    payee: { xMin: 0.06, xMax: 0.82, yMin: 0.56, yMax: 0.74 },
    numericAmount: { xMin: 0.7, xMax: 0.98, yMin: 0.52, yMax: 0.74 },
    date: { xMin: 0.68, xMax: 0.98, yMin: 0.7, yMax: 0.86 },
    checkNumber: { xMin: 0.7, xMax: 0.96, yMin: 0.86, yMax: 0.95 }
};

const parseNumber = (value) => {
    const normalized = value.replace(/,/g, '');
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
};

const formatCurrency = (amount) => amount.toFixed(2);

export const convertPdfToImages = async (pdfPath, outputDir) => {
    await ensureCommand('pdftoppm');
    const outputPrefix = join(outputDir, 'check');
    await runCommand('pdftoppm', ['-png', '-r', '300', pdfPath, outputPrefix]);
    const files = await readdir(outputDir);
    return files
        .filter((file) => file.startsWith('check-') && file.endsWith('.png'))
        .map((file) => join(outputDir, file))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const ocrImageLines = async (
    imagePath,
    regions = DEFAULT_OCR_REGIONS,
    engines = [],
    regionOrigin = 'top-left',
    includePreviews = false,
    regionAnchor = 'none',
    ocrModel = '',
    cropMaxSize = '',
    previewOnly = false,
    alignConfig = {}
) => {
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    try {
        await ensureCommand(pythonCommand);
    } catch {
        if (process.platform === 'win32') {
            await ensureCommand('py');
        } else {
            throw new Error('Python is required to run OCR.');
        }
    }
    const commandToRun = process.platform === 'win32' ? (await ensureCommand('python').then(() => 'python').catch(() => 'py')) : pythonCommand;
    const scriptPath = join(process.cwd(), 'server', 'ocr', 'handwriting_ocr.py');
    const stdout = await runCommand(commandToRun, [scriptPath, imagePath], {
        env: {
            ...process.env,
            DISABLE_MODEL_SOURCE_CHECK: 'True'
            ,
            OCR_REGIONS: JSON.stringify(regions || {}),
            OCR_ENGINES: JSON.stringify(engines || []),
            OCR_REGION_ORIGIN: regionOrigin || 'top-left',
            OCR_REGION_ANCHOR: regionAnchor || 'none',
            OCR_DEBUG_IMAGES: includePreviews ? '1' : '0',
            OCR_TROCR_MODEL: ocrModel || '',
            OCR_CROP_MAX_SIZE: cropMaxSize ? String(cropMaxSize) : '',
            OCR_PREVIEW_ONLY: previewOnly ? '1' : '0',
            OCR_ALIGN: alignConfig?.enabled ? '1' : '0',
            OCR_BOUNDS_PADDING: alignConfig?.boundsPadding != null ? String(alignConfig.boundsPadding) : '',
            OCR_DESKEW_MAX_ANGLE: alignConfig?.deskewMaxAngle != null ? String(alignConfig.deskewMaxAngle) : '',
            OCR_DESKEW_STEP: alignConfig?.deskewStep != null ? String(alignConfig.deskewStep) : '',
            OCR_DESKEW_BAND: alignConfig?.deskewBand != null ? String(alignConfig.deskewBand) : '',
            OCR_DESKEW_SCALE: alignConfig?.deskewScale != null ? String(alignConfig.deskewScale) : '',
            MICR_TESS_LANG: alignConfig?.micrTessLang ? String(alignConfig.micrTessLang) : ''
        }
    });
    let parsed;
    try {
        parsed = extractJsonPayload(stdout);
    } catch (error) {
        throw new Error(`OCR output is not valid JSON: ${error?.message || 'parse error'}`);
    }
    if (!parsed || !Array.isArray(parsed.lines)) {
        throw new Error('OCR output missing lines');
    }
    return parsed;
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const normalizeRegion = (region = {}) => ({
    xMin: clamp(region.xMin ?? 0),
    xMax: clamp(region.xMax ?? 1),
    yMin: clamp(region.yMin ?? 0),
    yMax: clamp(region.yMax ?? 1)
});

const isWithinRegion = (line, region, pageWidth, pageHeight) => {
    const x = (line.left + (line.right - line.left) / 2) / pageWidth;
    const y = (line.top + (line.bottom - line.top) / 2) / pageHeight;
    return x >= region.xMin && x <= region.xMax && y >= region.yMin && y <= region.yMax;
};

const collectRegionLines = (lines, region, pageWidth, pageHeight) =>
    lines
        .filter((line) => line.text)
        .filter((line) => isWithinRegion(line, region, pageWidth, pageHeight))
        .map((line) => line.text.trim())
        .filter(Boolean);

const extractCheckNumberFromLines = (lines) => {
    let best = '';
    lines.forEach((line) => {
        const matches = line.match(/\d{3,}/g) || [];
        matches.forEach((match) => {
            if (match.length > best.length) {
                best = match;
            }
        });
    });
    return best;
};

const extractAmountFromLines = (lines) => {
    const amounts = lines.flatMap((line) => findAmounts(line));
    if (!amounts.length) return null;
    return Math.max(...amounts);
};

const isValidAbaRouting = (digits) => {
    if (!/^\d{9}$/.test(digits)) return false;
    const nums = digits.split('').map((value) => Number.parseInt(value, 10));
    const sum =
        3 * (nums[0] + nums[3] + nums[6]) +
        7 * (nums[1] + nums[4] + nums[7]) +
        (nums[2] + nums[5] + nums[8]);
    return sum % 10 === 0;
};

const normalizeMicrDigits = (text = '') =>
    text
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/[Zz]/g, '2')
        .replace(/[Bb]/g, '8')
        .replace(/\D/g, '');

const parseMicrDigits = (digits = '') => {
    if (!digits) return null;
    let routing = '';
    let routingIndex = -1;
    for (let i = 0; i <= digits.length - 9; i += 1) {
        const candidate = digits.slice(i, i + 9);
        if (isValidAbaRouting(candidate)) {
            routing = candidate;
            routingIndex = i;
            break;
        }
    }

    if (!routing) {
        return {
            digits,
            routing: '',
            account: '',
            checkNumber: ''
        };
    }

    const remaining = `${digits.slice(0, routingIndex)}${digits.slice(routingIndex + 9)}`;
    let checkNumber = '';
    let account = remaining;

    if (remaining.length >= 1) {
        const possibleCheck = remaining.slice(-8);
        if (possibleCheck.length <= 6 || possibleCheck.length === 8) {
            checkNumber = possibleCheck.replace(/^0+/, '');
            account = remaining.slice(0, -possibleCheck.length);
        } else {
            checkNumber = remaining.slice(-6).replace(/^0+/, '');
            account = remaining.slice(0, -6);
        }
    }

    return {
        digits,
        routing,
        account,
        checkNumber
    };
};

const parseNumericAmountText = (text = '') => {
    if (!text) return null;
    const cleaned = text
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/[Zz]/g, '2')
        .replace(/[Bb]/g, '8')
        .replace(/,/g, '.')
        .replace(/[^0-9.]/g, ' ')
        .trim();
    const match = cleaned.match(/([0-9]+(?:\.[0-9]{2})?)/);
    if (!match) return null;
    const number = parseNumber(match[0]);
    return number ?? null;
};

const normalizeLegalToken = (token) => {
    const map = {
        there: 'three',
        tree: 'three',
        thrce: 'three',
        thre: 'three',
        to: 'two',
        too: 'two',
        for: 'four',
        fore: 'four',
        ate: 'eight',
        o: 'one',
        ole: 'one',
        won: 'one',
        thousnd: 'thousand',
        thousamd: 'thousand',
        hund: 'hundred',
        hunded: 'hundred',
        hundrd: 'hundred',
        cryly: 'eighty',
        olethmsand: 'one thousand',
        olethousand: 'one thousand',
        by: 'and',
        dollars: ''
    };
    return map[token] || token;
};

const levenshtein = (a, b) => {
    if (a === b) return 0;
    const aLen = a.length;
    const bLen = b.length;
    if (aLen === 0) return bLen;
    if (bLen === 0) return aLen;
    const dp = Array.from({ length: aLen + 1 }, () => Array(bLen + 1).fill(0));
    for (let i = 0; i <= aLen; i += 1) dp[i][0] = i;
    for (let j = 0; j <= bLen; j += 1) dp[0][j] = j;
    for (let i = 1; i <= aLen; i += 1) {
        for (let j = 1; j <= bLen; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[aLen][bLen];
};

const NUMBER_WORDS = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
    'eighty', 'ninety', 'hundred', 'thousand', 'million', 'and'
];

const correctLegalToken = (token) => {
    if (!token || /\d/.test(token) || token.includes('/')) return token;
    if (NUMBER_WORDS.includes(token)) return token;
    let best = token;
    let bestScore = Infinity;
    for (const word of NUMBER_WORDS) {
        const score = levenshtein(token, word);
        if (score < bestScore) {
            bestScore = score;
            best = word;
        }
    }
    const threshold = token.length >= 6 ? 3 : 2;
    return bestScore <= threshold ? best : token;
};

const parseAmountFromWords = (text = '') => {
    if (!text) return null;
    const normalizedText = text
        .toLowerCase()
        .replace(/olethmsand/g, 'one thousand')
        .replace(/olethousand/g, 'one thousand')
        .replace(/cryly/g, 'eighty')
        .replace(/\bdollars?\b/g, '');
    const tokens = normalizedText
        .replace(/[^a-z0-9/ ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(normalizeLegalToken)
        .map(correctLegalToken);

    const wordMap = {
        zero: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
        nineteen: 19,
        twenty: 20,
        thirty: 30,
        forty: 40,
        fifty: 50,
        sixty: 60,
        seventy: 70,
        eighty: 80,
        ninety: 90
    };

    let total = 0;
    let current = 0;
    let cents = null;
    let seen = false;

    for (const token of tokens) {
        if (token === 'and') continue;
        const centsMatch = token.match(/^([0-9]{1,2})\/100$/);
        if (centsMatch) {
            cents = Number.parseInt(centsMatch[1], 10);
            continue;
        }
        if (token === 'hundred') {
            if (current === 0) current = 1;
            current *= 100;
            seen = true;
            continue;
        }
        if (token === 'thousand') {
            total += (current || 1) * 1000;
            current = 0;
            seen = true;
            continue;
        }
        if (token === 'million') {
            total += (current || 1) * 1000000;
            current = 0;
            seen = true;
            continue;
        }
        if (wordMap[token] != null) {
            current += wordMap[token];
            seen = true;
            continue;
        }
    }

    if (!seen) return null;
    total += current;
    if (cents != null) {
        total += cents / 100;
    }
    return total || 0;
};

const refineNumericAmountWithLegal = (numericText = '', legalAmountValue) => {
    if (!numericText || legalAmountValue == null) return null;
    const cleaned = numericText
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/[Zz]/g, '2')
        .replace(/[Bb]/g, '8')
        .replace(/[^0-9.]/g, '');
    if (!cleaned) return null;
    const parts = cleaned.split('.');
    const intPart = parts[0] || '';
    const fracPart = parts[1] || '';
    const candidates = new Set([cleaned]);
    const swaps = { '1': '7', '7': '1', '0': '6', '6': '0', '5': '6', '6': '5' };
    for (let i = 0; i < intPart.length; i += 1) {
        const digit = intPart[i];
        if (!swaps[digit]) continue;
        const replaced = `${intPart.slice(0, i)}${swaps[digit]}${intPart.slice(i + 1)}`;
        candidates.add(fracPart ? `${replaced}.${fracPart}` : replaced);
    }
    let bestValue = null;
    let bestDiff = Infinity;
    for (const candidate of candidates) {
        const value = parseNumber(candidate);
        if (value == null) continue;
        const diff = Math.abs(value - legalAmountValue);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestValue = value;
        }
    }
    return bestValue;
};

const parseCheckFromOcr = (ocrResult, regions = DEFAULT_OCR_REGIONS) => {
    const { width: pageWidth = 1, height: pageHeight = 1, lines } = ocrResult;
    const regionText = ocrResult?.regions || null;
    const normalizedRegions = {
        checkNumber: normalizeRegion(regions.checkNumber),
        numericAmount: normalizeRegion(regions.numericAmount || regions.amount),
        legalAmount: normalizeRegion(regions.legalAmount || {})
    };

    let checkLines = [];
    let numericAmountLines = [];
    let legalAmountLines = [];

    if (regionText) {
        const checkText = regionText.checkNumber?.text || '';
        const numericText = regionText.numericAmount?.text || '';
        const legalText = regionText.legalAmount?.text || '';
        checkLines = checkText ? [checkText] : [];
        numericAmountLines = numericText ? [numericText] : [];
        legalAmountLines = legalText ? [legalText] : [];
    } else {
        checkLines = collectRegionLines(lines, normalizedRegions.checkNumber, pageWidth, pageHeight);
        numericAmountLines = collectRegionLines(lines, normalizedRegions.numericAmount, pageWidth, pageHeight);
        legalAmountLines = normalizedRegions.legalAmount
            ? collectRegionLines(lines, normalizedRegions.legalAmount, pageWidth, pageHeight)
            : [];
    }

    const checkNumber = '';
    const micrDigits = regionText?.micr?.text ? normalizeMicrDigits(regionText.micr.text) : '';
    const micrParsed = micrDigits ? parseMicrDigits(micrDigits) : null;
    let amount = extractAmountFromLines(numericAmountLines);
    const legalAmountText = legalAmountLines.join(' ').trim();
    let legalAmountValue = extractAmountFromLines(legalAmountLines);
    if (legalAmountValue == null) {
        legalAmountValue = parseAmountFromWords(legalAmountText);
    }
    if (amount == null) {
        amount = parseNumericAmountText(numericAmountLines.join(' '));
    }
    const refinedAmount = refineNumericAmountWithLegal(numericAmountLines.join(' '), legalAmountValue);
    if (refinedAmount != null) {
        amount = refinedAmount;
    }
    if (amount == null && legalAmountValue != null) {
        amount = legalAmountValue;
    }
    let amountMatch = null;
    if (amount != null && legalAmountValue != null) {
        amountMatch = Math.abs(amount - legalAmountValue) < 0.01;
    }

    if (amount == null) {
        const fullText = lines.map((line) => line.text).join('\n');
        const fallback = parseCheckFromText(fullText);
        if (amount == null) {
            amount = fallback.amount ?? null;
        }
    }

    return {
        checkNumber,
        amount,
        legalAmountText,
        amountMatch,
        micrDigits,
        micrParsed
    };
};

const findCheckNumber = (text) => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const patterns = [
        /check\s*(?:no\.?|number|#)?\s*[:#]?\s*([0-9]{3,})/i,
        /\bno\.?\s*[:#]?\s*([0-9]{3,})/i
    ];

    for (const line of lines) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) return match[1];
        }
    }

    const micrLine = lines.find((line) => line.length > 20 && /[0-9]{6,}/.test(line));
    if (micrLine) {
        const digits = micrLine.match(/[0-9]{3,}/g);
        if (digits && digits.length) return digits[digits.length - 1];
    }

    return '';
};

const findAmounts = (text) => {
    const matches = text.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/g) || [];
    return matches
        .map((match) => match.replace(/[^0-9.,]/g, ''))
        .map(parseNumber)
        .filter((value) => Number.isFinite(value));
};

export const parseCheckFromText = (text) => {
    const checkNumber = findCheckNumber(text);
    const amounts = findAmounts(text);
    const amount = amounts.length ? Math.max(...amounts) : null;
    return {
        checkNumber,
        amount
    };
};

export const extractChecksFromPdf = async (checksPdfPath, options = {}) => {
    const regions = options.ocrRegions || DEFAULT_OCR_REGIONS;
    const includeOcrLines = options.includeOcrLines === true;
    const ocrEngines = options.ocrEngines || [];
    const regionOrigin = options.ocrRegionOrigin || 'top-left';
    const regionAnchor = options.ocrRegionAnchor || 'none';
    const ocrModel = options.ocrModel || '';
    const cropMaxSize = options.ocrCropMaxSize || '';
    const previewOnly = options.ocrPreviewOnly === true;
    const alignConfig = options.ocrAlign || {};
    const tempDir = await getTempDir();
    try {
        const images = await convertPdfToImages(checksPdfPath, tempDir);
        const checks = [];

        for (const imagePath of images) {
            const ocrResult = await ocrImageLines(
                imagePath,
                regions,
                ocrEngines,
                regionOrigin,
                includeOcrLines,
                regionAnchor,
                ocrModel,
                cropMaxSize,
                previewOnly,
                alignConfig
            );
            const result = parseCheckFromOcr(ocrResult, regions);
            const checkNumber = result.checkNumber || '';
            const amount = result.amount ?? null;
            const legalAmountText = result.legalAmountText || '';
            const micrDigits = result.micrDigits || '';
            const micrParsed = result.micrParsed || null;
            const ocrLines = includeOcrLines
                ? ocrResult.lines
                    .filter((line) => line.text)
                    .map(({ text, left, top, right, bottom, conf }) => ({
                        text,
                        left,
                        top,
                        right,
                        bottom,
                        conf
                    }))
                : undefined;
            checks.push({
                source: basename(imagePath),
                checkNumber,
                amount,
                missing: {
                    checkNumber: !checkNumber,
                    amount: amount == null,
                    legalAmountText: !legalAmountText
                },
                ocrLines,
                ocrError: ocrResult.error || (ocrResult.errors && ocrResult.errors.length ? ocrResult.errors.join('; ') : null),
                legalAmountText,
                amountMatch: result.amountMatch ?? null,
                micrDigits,
                micrParsed,
                ocrRegions: includeOcrLines ? ocrResult.regions || null : null,
                alignedPreviewBase64: includeOcrLines ? ocrResult.alignedPreviewBase64 || null : null
            });
        }

        return checks;
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
};

export const extractChecksFromImages = async (imagePaths, options = {}) => {
    const regions = options.ocrRegions || DEFAULT_OCR_REGIONS;
    const includeOcrLines = options.includeOcrLines === true;
    const ocrEngines = options.ocrEngines || [];
    const regionOrigin = options.ocrRegionOrigin || 'top-left';
    const regionAnchor = options.ocrRegionAnchor || 'none';
    const ocrModel = options.ocrModel || '';
    const cropMaxSize = options.ocrCropMaxSize || '';
    const previewOnly = options.ocrPreviewOnly === true;
    const alignConfig = options.ocrAlign || {};
    const normalized = imagePaths.map((entry) => {
        if (typeof entry === 'string') {
            return { path: entry, source: basename(entry) };
        }
        return {
            path: entry.path,
            source: entry.source || basename(entry.path)
        };
    });

    const checks = [];
    for (const image of normalized) {
        const ocrResult = await ocrImageLines(
            image.path,
            regions,
            ocrEngines,
            regionOrigin,
            includeOcrLines,
            regionAnchor,
            ocrModel,
            cropMaxSize,
            previewOnly,
            alignConfig
        );
        const result = parseCheckFromOcr(ocrResult, regions);
        const checkNumber = result.checkNumber || '';
        const amount = result.amount ?? null;
        const legalAmountText = result.legalAmountText || '';
        const micrDigits = result.micrDigits || '';
        const micrParsed = result.micrParsed || null;
        const ocrLines = includeOcrLines
            ? ocrResult.lines
                .filter((line) => line.text)
                .map(({ text, left, top, right, bottom, conf }) => ({
                    text,
                    left,
                    top,
                    right,
                    bottom,
                    conf
                }))
            : undefined;
        checks.push({
            source: image.source,
            checkNumber,
            amount,
            missing: {
                checkNumber: !checkNumber,
                amount: amount == null,
                legalAmountText: !legalAmountText
            },
            ocrLines,
            ocrError: ocrResult.error || (ocrResult.errors && ocrResult.errors.length ? ocrResult.errors.join('; ') : null),
            legalAmountText,
            amountMatch: result.amountMatch ?? null,
            micrDigits,
            micrParsed,
            ocrRegions: includeOcrLines ? ocrResult.regions || null : null,
            alignedPreviewBase64: includeOcrLines ? ocrResult.alignedPreviewBase64 || null : null
        });
    }
    return checks;
};

const getFieldMaybe = (form, fieldName) => {
    try {
        return form.getField(fieldName);
    } catch {
        return null;
    }
};

const fillField = (form, fieldName, value) => {
    if (!fieldName) return;
    const field = getFieldMaybe(form, fieldName);
    if (!field) return;
    field.setText(value ?? '');
};

export const buildDepositSlipPdf = async ({ templatePath, outputPath, checks, fieldMap, totalOverride }) => {
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const total = Number.isFinite(totalOverride)
        ? totalOverride
        : checks.reduce((sum, check) => sum + (Number.isFinite(check.amount) ? check.amount : 0), 0);

    const checkFields = fieldMap?.checks || [];
    checkFields.forEach((mapping, index) => {
        const check = checks[index];
        if (!check) return;
        fillField(form, mapping.number, check.checkNumber || '');
        fillField(form, mapping.amount, check.amount != null ? formatCurrency(check.amount) : '');
    });

    if (fieldMap?.total) {
        fillField(form, fieldMap.total, formatCurrency(total));
    }

    if (fieldMap?.date) {
        fillField(form, fieldMap.date, new Date().toLocaleDateString('en-US'));
    }

    const pdfBytes = await pdfDoc.save();
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, pdfBytes);
};
