import test from 'node:test';
import assert from 'node:assert/strict';

import { __TEST__ } from '../server/services/constantContactService.js';

test('validateEmailInput accepts complete Sunday email payload', () => {
    const result = __TEST__.validateEmailInput({
        date: 'February 15, 2026',
        sundayName: 'Last Sunday after Epiphany',
        youtubeLink: 'https://youtube.com/live/example',
        pdfUrl: 'https://dropbox.example/bulletin.pdf',
        imageUrl: 'https://dropbox.example/preview.png'
    });

    assert.equal(result.date, 'February 15, 2026');
    assert.equal(result.sundayName, 'Last Sunday after Epiphany');
    assert.equal(result.youtubeLink, 'https://youtube.com/live/example');
    assert.equal(result.pdfUrl, 'https://dropbox.example/bulletin.pdf');
    assert.equal(result.imageUrl, 'https://dropbox.example/preview.png');
    assert.equal(result.testEmpty, false);
});

test('validateEmailInput rejects incomplete payload when not test mode', () => {
    assert.throws(
        () => __TEST__.validateEmailInput({
            date: 'February 15, 2026',
            sundayName: 'Last Sunday after Epiphany',
            youtubeLink: '',
            pdfUrl: '',
            imageUrl: ''
        }),
        /Missing email data/
    );
});

test('validateEmailInput preserves optional fromEmail and allows testEmpty payload', () => {
    const result = __TEST__.validateEmailInput({
        testEmpty: true,
        fromEmail: '  office@example.org  '
    });

    assert.equal(result.testEmpty, true);
    assert.equal(result.fromEmail, 'office@example.org');
});

