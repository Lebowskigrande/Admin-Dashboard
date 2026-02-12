import { extname } from 'path';
import { access } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { getDefaultPrinterName, resolveSumatraPdfPath } from '../helpers/finance-utils.js';

const execFileAsync = promisify(execFile);

const normalizeCopies = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.min(Math.floor(parsed), 99);
};

export const printFile = async (filePath, options = {}) => {
    const copies = normalizeCopies(options.copies);
    const preferredPrinter = String(options.printer || options.printerName || '').trim();
    const printerName = preferredPrinter || await getDefaultPrinterName().catch(() => null);
    const sumatraPath = await resolveSumatraPdfPath();
    const extension = extname(filePath || '').toLowerCase();

    await access(filePath);

    if (sumatraPath && extension === '.pdf') {
        const sumatraArgs = printerName
            ? ['-silent', '-print-to', printerName, '-exit-on-print']
            : ['-silent', '-print-to-default', '-exit-on-print'];
        if (copies > 1) {
            sumatraArgs.push('-print-settings', `${copies}x`);
        }
        sumatraArgs.push(filePath);
        await execFileAsync(sumatraPath, sumatraArgs, { windowsHide: true });
        return { success: true, printer: printerName || null, method: 'sumatra', copies };
    }

    const escapedPath = filePath.replace(/'/g, "''");
    const escapedPrinter = printerName ? printerName.replace(/'/g, "''") : '';
    const script = [
        `$path = '${escapedPath}'`,
        printerName ? `$printer = '${escapedPrinter}'` : `$printer = $null`,
        `$printed = $false`,
        `if ($printer) {`,
        `  try { Start-Process -FilePath $path -Verb PrintTo -ArgumentList $printer; $printed = $true } catch { }`,
        `}`,
        `if (-not $printed) { Start-Process -FilePath $path -Verb Print }`
    ].join('; ');

    await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    return { success: true, printer: printerName || null, method: 'shell', copies };
};
