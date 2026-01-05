import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { buildDepositSlipPdf, extractChecksFromImages, extractChecksFromPdf } from './depositSlip.js';

const getArgValue = (args, flag) => {
    const index = args.indexOf(flag);
    if (index === -1) return null;
    return args[index + 1] || null;
};

const loadConfig = async (configPath) => {
    if (!configPath) return null;
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content);
};

const run = async () => {
    const args = process.argv.slice(2);
    const checksPdf = getArgValue(args, '--checks');
    const imagesDir = getArgValue(args, '--images-dir');
    const imagesList = getArgValue(args, '--images');
    const configPath = getArgValue(args, '--config') || 'server/depositSlipConfig.json';
    const outputPathOverride = getArgValue(args, '--output');

    if (!checksPdf && !imagesDir && !imagesList) {
        console.error('Usage: node server/build_deposit_slip.js --checks checks.pdf [--config path] [--output path]');
        console.error('   or: node server/build_deposit_slip.js --images-dir scans [--config path] [--output path]');
        console.error('   or: node server/build_deposit_slip.js --images img1.png,img2.jpg [--config path] [--output path]');
        process.exit(1);
    }

    const config = await loadConfig(configPath).catch(() => null);
    if (!config) {
        console.error(`Missing config file: ${configPath}`);
        console.error('Create one based on server/depositSlipConfig.sample.json.');
        process.exit(1);
    }

    const templatePath = resolve(config.templatePath || 'deposit slip template.pdf');
    const outputPath = resolve(outputPathOverride || config.outputPath || 'output/deposit-slip.pdf');

    let checks = [];
    if (checksPdf) {
        checks = await extractChecksFromPdf(resolve(checksPdf), { ocrRegions: config.ocrRegions });
    } else if (imagesDir) {
        const files = await readdir(resolve(imagesDir));
        const imagePaths = files
            .filter((file) => /\.(png|jpg|jpeg)$/i.test(file))
            .map((file) => resolve(imagesDir, file))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        checks = await extractChecksFromImages(imagePaths, { ocrRegions: config.ocrRegions });
    } else if (imagesList) {
        const imagePaths = imagesList
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => resolve(value));
        checks = await extractChecksFromImages(imagePaths, { ocrRegions: config.ocrRegions });
    }
    await buildDepositSlipPdf({
        templatePath,
        outputPath,
        checks,
        fieldMap: config.fieldMap || {}
    });

    console.log(`Created deposit slip: ${outputPath}`);
};

run().catch((error) => {
    console.error('Deposit slip build failed:', error.message);
    process.exit(1);
});
