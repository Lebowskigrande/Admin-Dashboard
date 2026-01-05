import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

const runCommand = async (command, args, options = {}) => {
    try {
        const result = await execFileAsync(command, args, options);
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
    checkNumber: {
        xMin: 0.6,
        xMax: 1,
        yMin: 0.0,
        yMax: 0.35
    },
    amount: {
        xMin: 0.55,
        xMax: 1,
        yMin: 0.3,
        yMax: 0.75
    }
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

const ocrImageLines = async (imagePath) => {
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
        }
    });
    const jsonStart = stdout.lastIndexOf('{');
    if (jsonStart === -1) {
        throw new Error('OCR output missing JSON payload.');
    }
    const jsonPayload = stdout.slice(jsonStart).trim();
    let parsed;
    try {
        parsed = JSON.parse(jsonPayload);
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

const parseCheckFromOcr = (ocrResult, regions = DEFAULT_OCR_REGIONS) => {
    const { width: pageWidth = 1, height: pageHeight = 1, lines } = ocrResult;
    const normalizedRegions = {
        checkNumber: normalizeRegion(regions.checkNumber),
        amount: normalizeRegion(regions.amount)
    };

    const checkLines = collectRegionLines(lines, normalizedRegions.checkNumber, pageWidth, pageHeight);
    const amountLines = collectRegionLines(lines, normalizedRegions.amount, pageWidth, pageHeight);

    let checkNumber = extractCheckNumberFromLines(checkLines);
    let amount = extractAmountFromLines(amountLines);

    if (!checkNumber || amount == null) {
        const fullText = lines.map((line) => line.text).join('\n');
        const fallback = parseCheckFromText(fullText);
        if (!checkNumber) {
            checkNumber = fallback.checkNumber || '';
        }
        if (amount == null) {
            amount = fallback.amount ?? null;
        }
    }

    return { checkNumber, amount };
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
    const tempDir = await getTempDir();
    try {
        const images = await convertPdfToImages(checksPdfPath, tempDir);
        const checks = [];

        for (const imagePath of images) {
            const ocrResult = await ocrImageLines(imagePath);
            const result = parseCheckFromOcr(ocrResult, regions);
            const checkNumber = result.checkNumber || '';
            const amount = result.amount ?? null;
            checks.push({
                source: basename(imagePath),
                checkNumber,
                amount,
                missing: {
                    checkNumber: !checkNumber,
                    amount: amount == null
                }
            });
        }

        return checks;
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
};

export const extractChecksFromImages = async (imagePaths, options = {}) => {
    const regions = options.ocrRegions || DEFAULT_OCR_REGIONS;
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
        const ocrResult = await ocrImageLines(image.path);
        const result = parseCheckFromOcr(ocrResult, regions);
        const checkNumber = result.checkNumber || '';
        const amount = result.amount ?? null;
        checks.push({
            source: image.source,
            checkNumber,
            amount,
            missing: {
                checkNumber: !checkNumber,
                amount: amount == null
            }
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

export const buildDepositSlipPdf = async ({ templatePath, outputPath, checks, fieldMap }) => {
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const total = checks.reduce((sum, check) => sum + (check.amount || 0), 0);

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
