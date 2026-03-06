import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { extractVendorFromPdfBytes } from '../server/services/apVendorExtractor.js';

const inputDir = process.argv[2]
    ? resolve(process.argv[2])
    : '';

if (!inputDir) {
    console.error('Usage: node scripts/extract-ap-vendors.js "<path-to-ap-pdf-folder>"');
    process.exit(1);
}

const main = async () => {
    const entries = await readdir(inputDir, { withFileTypes: true });
    const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
        .map((entry) => join(inputDir, entry.name))
        .sort((a, b) => a.localeCompare(b));

    const results = [];
    for (const filePath of files) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        try {
            const bytes = await readFile(filePath);
            const extracted = await extractVendorFromPdfBytes(bytes);
            results.push({
                file: fileName,
                vendor: extracted.vendor || '',
                confidence: Number((extracted.confidence || 0).toFixed(3)),
                method: extracted.method || ''
            });
        } catch (error) {
            results.push({
                file: fileName,
                vendor: '',
                confidence: 0,
                method: `error: ${String(error?.message || error)}`
            });
        }
    }

    console.log(JSON.stringify({
        folder: inputDir,
        total: results.length,
        extracted: results.filter((row) => row.vendor).length,
        unknown: results.filter((row) => !row.vendor).length,
        results
    }, null, 2));
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

