import express from 'express';
import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { writeFile, rm } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { sqlite as db } from '../db.js';
import { requireAuth, getUserTokens } from '../helpers/auth.js';
import {
    createOAuthClient,
    setStoredCredentials
} from '../googleAuth.js';
import {
    HGK_SUPPLY_ITEMS,
    HGK_WEBHOOK_TOKEN,
    formatMonthKey,
    upsertHgkSupplyRequest,
    extractGmailMessageText,
    parseSupplyEmail,
    escapePsString
} from '../helpers/hgk-utils.js';

const router = express.Router();
const HGK_GMAIL_LABEL = 'HGK Supplies Parsed';

const ensureGmailLabel = async (gmail, name) => {
    const listResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = Array.isArray(listResponse.data.labels) ? listResponse.data.labels : [];
    const existing = labels.find((label) => label.name === name);
    if (existing?.id) return existing.id;
    const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show'
        }
    });
    return created.data.id;
};

router.get('/api/hgk/items', (req, res) => {
    res.json(HGK_SUPPLY_ITEMS);
});

router.get('/api/hgk/supplies', (req, res) => {
    const monthKey = formatMonthKey(req.query.month);
    const request = db.prepare('SELECT * FROM hgk_supply_requests WHERE month = ?').get(monthKey);
    const items = request
        ? db.prepare('SELECT * FROM hgk_supply_items WHERE request_id = ? ORDER BY item_name').all(request.id)
        : [];
    res.json({
        month: monthKey,
        request: request || null,
        items
    });
});

router.post('/api/hgk/supplies', (req, res) => {
    try {
        const monthKey = formatMonthKey(req.body?.month);
        const notes = String(req.body?.notes || '').trim();
        const incomingItems = Array.isArray(req.body?.items) && req.body.items.length > 0
            ? req.body.items
            : HGK_SUPPLY_ITEMS.map((name) => ({ item_name: name }));
        const result = upsertHgkSupplyRequest(monthKey, notes, incomingItems);
        res.json(result);
    } catch (error) {
        console.error('Save HGK supplies error:', error);
        res.status(500).json({ error: 'Failed to persist HGK supplies' });
    }
});

router.post('/api/hgk/gmail-search', requireAuth, async (req, res) => {
    try {
        const tokens = getUserTokens(req.user.id);
        if (!tokens) {
            return res.status(401).json({ error: 'Not connected to Google' });
        }
        const client = createOAuthClient();
        setStoredCredentials(client, tokens);
        const gmail = google.gmail({ version: 'v1', auth: client });
        const query = 'subject:supplies (HGK OR "Holy Ghost Kitchen")';
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 5
        });
        const messageId = listResponse.data.messages?.[0]?.id;
        if (!messageId) {
            return res.json({ message: null, items: [] });
        }
        const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });
        const payload = messageResponse.data.payload;
        const headers = Array.isArray(payload?.headers) ? payload.headers : [];
        const subject = headers.find((header) => header.name?.toLowerCase() === 'subject')?.value || '';
        const date = headers.find((header) => header.name?.toLowerCase() === 'date')?.value || '';
        const bodyText = extractGmailMessageText(messageResponse.data) || messageResponse.data.snippet || '';
        const parsedItems = parseSupplyEmail(bodyText);
        const hasDetected = parsedItems.some((item) => item.detected && item.quantity);
        if (hasDetected) {
            const labelId = await ensureGmailLabel(gmail, HGK_GMAIL_LABEL);
            const threadId = messageResponse.data.threadId || '';
            if (threadId && labelId) {
                await gmail.users.threads.modify({
                    userId: 'me',
                    id: threadId,
                    requestBody: { addLabelIds: [labelId] }
                });
            } else if (labelId) {
                await gmail.users.messages.modify({
                    userId: 'me',
                    id: messageId,
                    requestBody: { addLabelIds: [labelId] }
                });
            }
        }
        res.json({
            message: { id: messageId, subject, date },
            items: parsedItems
        });
    } catch (error) {
        console.error('HGK Gmail search error:', error);
        res.status(500).json({ error: 'Failed to search Gmail' });
    }
});

router.post('/api/hgk/email/webhook', (req, res) => {
    try {
        if (HGK_WEBHOOK_TOKEN) {
            const incomingToken = String(req.headers['x-hgk-webhook-token'] || '').trim();
            if (!incomingToken || incomingToken !== HGK_WEBHOOK_TOKEN) {
                return res.status(403).json({ error: 'Invalid webhook token' });
            }
        }
        const emailText = String(req.body?.text || '').trim();
        if (!emailText) {
            return res.status(400).json({ error: 'Email body text is required' });
        }
        const monthKey = formatMonthKey(req.body?.month);
        const notes = String(req.body?.notes || req.body?.subject || '').trim();
        const parsedItems = parseSupplyEmail(emailText);
        const result = upsertHgkSupplyRequest(monthKey, notes, parsedItems);
        res.json({
            ...result,
            parsed: parsedItems
        });
    } catch (error) {
        console.error('HGK email webhook error:', error);
        res.status(500).json({ error: 'Failed to process HGK email' });
    }
});

router.post('/api/hgk/email', (req, res) => {
    const text = String(req.body?.text || '');
    const monthKey = formatMonthKey(req.body?.month);
    const parsedItems = parseSupplyEmail(text);
    res.json({
        month: monthKey,
        items: parsedItems
    });
});

const HGK_INSTACART_LIST_URL = 'https://www.instacart.com/store/list/08b147ca-259d-4fd2-b3ff-315e94880261?utm_medium=shared_list';

router.post('/api/hgk/instacart', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const title = String(req.body?.title || 'HGK Supplies').trim() || 'HGK Supplies';
        if (items.length === 0) {
            return res.status(400).json({ error: 'No items provided' });
        }
        const lines = items
            .map((item) => {
                const name = String(item?.name || '').trim();
                const display = String(item?.display || '').trim();
                if (!name || !display) return null;
                return `${name}: ${display}`;
            })
            .filter(Boolean);
        if (lines.length === 0) {
            return res.status(400).json({ error: 'No valid items provided' });
        }

        const listText = lines.join('\r\n');
        const listTextBase64 = Buffer.from(listText, 'utf8').toString('base64');
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("gdi32.dll", SetLastError=true)]
    public static extern IntPtr CreateRoundRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect, int nWidthEllipse, int nHeightEllipse);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);
}
public struct MARGINS {
    public int cxLeftWidth;
    public int cxRightWidth;
    public int cyTopHeight;
    public int cyBottomHeight;
}
public class Dwm {
    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMargins);
}
"@

$rawList = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${listTextBase64}'))

$shadow = New-Object System.Windows.Forms.Form
$shadow.FormBorderStyle = 'None'
$shadow.ShowInTaskbar = $false
$shadow.StartPosition = 'Manual'
$shadow.BackColor = [System.Drawing.Color]::Black
$shadow.Opacity = 0.18
$shadow.TopMost = $true
$shadow.Size = New-Object System.Drawing.Size(374, 454)
$shadow.Location = New-Object System.Drawing.Point([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Right - 377, 47)

$form = New-Object System.Windows.Forms.Form
$form.Text = '${escapePsString(title)}'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::White
$form.Size = New-Object System.Drawing.Size(360, 440)
$form.Location = New-Object System.Drawing.Point([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Right - 370, 40)

$form.Add_Shown({
    $radius = 20
    $rgn = [Win32]::CreateRoundRectRgn(0, 0, $form.Width + 1, $form.Height + 1, $radius, $radius)
    [Win32]::SetWindowRgn($form.Handle, $rgn, $true) | Out-Null
    $margins = New-Object MARGINS
    $margins.cxLeftWidth = -1
    $margins.cxRightWidth = -1
    $margins.cyTopHeight = -1
    $margins.cyBottomHeight = -1
    [Dwm]::DwmExtendFrameIntoClientArea($form.Handle, [ref]$margins) | Out-Null
})

$syncShadow = {
    $shadow.Location = New-Object System.Drawing.Point($form.Location.X - 7, $form.Location.Y - 7)
    $shadow.Size = New-Object System.Drawing.Size($form.Width + 14, $form.Height + 14)
}

$form.Add_LocationChanged({ & $syncShadow })
$form.Add_SizeChanged({ & $syncShadow })
$form.Add_Shown({ & $syncShadow })
$form.Add_FormClosed({ $shadow.Close() })

$shell = New-Object System.Windows.Forms.Panel
$shell.Dock = 'Fill'
$shell.Padding = New-Object System.Windows.Forms.Padding(16, 14, 16, 12)
$shell.BackColor = [System.Drawing.Color]::White
$shell.BorderStyle = 'FixedSingle'

$title = New-Object System.Windows.Forms.Label
$title.Text = '${escapePsString(title)}'
$title.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
$title.Dock = 'Top'
$title.Height = 32
$title.Padding = New-Object System.Windows.Forms.Padding(0, 0, 0, 0)
$title.TextAlign = 'MiddleLeft'

$divider = New-Object System.Windows.Forms.Panel
$divider.Dock = 'Top'
$divider.Height = 1
$divider.BackColor = [System.Drawing.Color]::FromArgb(226, 232, 240)

$listPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$listPanel.Dock = 'Fill'
$listPanel.FlowDirection = 'TopDown'
$listPanel.WrapContents = $false
$listPanel.AutoScroll = $true
$listPanel.Padding = New-Object System.Windows.Forms.Padding(0, 8, 0, 8)

$lines = $rawList -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 }

foreach ($line in $lines) {
    $row = New-Object System.Windows.Forms.Panel
    $row.Height = 30
    $row.Width = 300
    $row.Margin = New-Object System.Windows.Forms.Padding(0, 2, 0, 2)

    $check = New-Object System.Windows.Forms.CheckBox
    $check.Width = 22
    $check.Height = 22
    $check.Location = New-Object System.Drawing.Point(0, 3)
    $check.FlatStyle = 'Flat'
    $check.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
    $check.FlatAppearance.CheckedBackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
    $check.BackColor = [System.Drawing.Color]::White

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $line
    $label.AutoSize = $false
    $label.Location = New-Object System.Drawing.Point(28, 0)
    $label.Size = New-Object System.Drawing.Size(260, 30)
    $label.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $label.TextAlign = 'MiddleLeft'

    $row.Controls.Add($check)
    $row.Controls.Add($label)
    $listPanel.Controls.Add($row)
}

$close = New-Object System.Windows.Forms.Button
$close.Text = 'Close'
$close.Dock = 'Bottom'
$close.Height = 32
$close.FlatStyle = 'Flat'
$close.BackColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$close.ForeColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$close.FlatAppearance.BorderSize = 0
$close.Add_Click({ $form.Close() })

$shell.Controls.Add($listPanel)
$shell.Controls.Add($divider)
$shell.Controls.Add($title)
$form.Controls.Add($shell)
$form.Controls.Add($close)

Start-Process '${escapePsString(HGK_INSTACART_LIST_URL)}'

[void]$shadow.Show()
[System.Windows.Forms.Application]::Run($form)
`;

        const scriptPath = resolve(tmpdir(), `hgk-instacart-${randomUUID()}.ps1`);
        await writeFile(scriptPath, script, 'utf8');
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true }, () => {
            rm(scriptPath, { force: true }).catch(() => { });
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('HGK Instacart overlay error:', error);
        res.status(500).json({ error: 'Failed to open Instacart list' });
    }
});

export default router;
