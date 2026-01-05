import { readFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

const templatePath = process.argv[2] || 'deposit slip template.pdf';

const run = async () => {
    const pdfBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    console.log(`Fields in ${templatePath}:`);
    fields.forEach((field) => {
        const name = field.getName();
        console.log(`- ${name}`);
    });
};

run().catch((error) => {
    console.error('Failed to read PDF fields:', error.message);
    process.exit(1);
});
