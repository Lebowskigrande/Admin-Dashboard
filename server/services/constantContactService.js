import {
    CC_API_BASE,
    ensureCcAccessToken,
    fetchCcFromEmails,
    fetchCcJson,
    findCcListId,
    getNextSaturdayAtSix,
    loadEmailTemplate,
    sanitizeEmailHtml
} from '../helpers/communications-utils.js';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const pickFirstEmail = (list = []) => {
    for (const entry of list) {
        const candidate = entry?.email_address || entry?.email || entry?.address || '';
        if (candidate) return candidate;
    }
    return '';
};

const validateEmailInput = (input) => {
    const testEmpty = !!input?.testEmpty;
    const normalized = {
        date: String(input?.date || '').trim(),
        sundayName: String(input?.sundayName || '').trim(),
        youtubeLink: String(input?.youtubeLink || '').trim(),
        pdfUrl: String(input?.pdfUrl || '').trim(),
        imageUrl: String(input?.imageUrl || '').trim(),
        testEmpty,
        fromEmail: String(input?.fromEmail || '').trim()
    };

    if (!testEmpty) {
        const missing = Object.entries({
            date: normalized.date,
            sundayName: normalized.sundayName,
            youtubeLink: normalized.youtubeLink,
            pdfUrl: normalized.pdfUrl,
            imageUrl: normalized.imageUrl
        }).filter(([, value]) => !value).map(([key]) => key);
        if (missing.length) {
            const error = new Error(`Missing email data: ${missing.join(', ')}`);
            error.statusCode = 400;
            throw error;
        }
    }

    return normalized;
};

const buildEmailHtml = async ({ testEmpty, date, sundayName, youtubeLink, pdfUrl, imageUrl }) => {
    if (testEmpty) {
        return {
            html: '<html><body><p>Test email</p></body></html>',
            minimalHtml: '<html><body><p>Test email</p></body></html>',
            subject: 'Test Email',
            campaignName: `Test Email ${new Date().toISOString()}`
        };
    }

    const template = await loadEmailTemplate();
    const html = sanitizeEmailHtml(template
        .replace(/\[\[\[DATE\]\]\]/g, date)
        .replace(/\[\[\[SUNDAY_NAME\]\]\]/g, sundayName)
        .replace(/\[\[\[YOUTUBE_LINK\]\]\]/g, youtubeLink)
        .replace(/\[\[\[IMG_SRC\]\]\]/g, imageUrl)
        .replace(/\[\[\[PDF_SRC\]\]\]/g, pdfUrl));

    const minimalHtml = `
<html>
  <body>
    <h1>${sundayName}</h1>
    <p>${date}</p>
    <p><a href="${youtubeLink}">Watch the livestream</a></p>
    <p><a href="${pdfUrl}">Download the bulletin</a></p>
    <img src="${imageUrl}" alt="Sunday Bulletin preview" />
  </body>
</html>`;

    return {
        html,
        minimalHtml,
        subject: 'Sunday Livestream',
        campaignName: 'Sunday Bulletin'
    };
};

export const createAndScheduleConstantContactEmail = async ({ userId, input }) => {
    const tokens = await ensureCcAccessToken(userId);
    if (!tokens?.access_token) {
        const error = new Error('Constant Contact not connected');
        error.statusCode = 401;
        throw error;
    }

    const normalizedInput = validateEmailInput(input);
    const {
        date,
        sundayName,
        youtubeLink,
        pdfUrl,
        imageUrl,
        testEmpty,
        fromEmail: requestedFromEmail
    } = normalizedInput;

    let listId = await findCcListId(tokens, 'Active Members');
    if (!listId) {
        const listData = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
        const lists = Array.isArray(listData?.lists) ? listData.lists : [];
        listId = lists[0]?.list_id || null;
    }
    if (!listId) {
        const error = new Error('No Constant Contact lists available');
        error.statusCode = 404;
        throw error;
    }

    const { html, minimalHtml, subject, campaignName } = await buildEmailHtml({
        testEmpty,
        date,
        sundayName,
        youtubeLink,
        pdfUrl,
        imageUrl
    });

    const allowedEmails = await fetchCcFromEmails(tokens).catch(() => []);
    const confirmedEmails = allowedEmails.filter((entry) => {
        const status = (entry?.status || '').toLowerCase();
        return status === 'confirmed' || status === 'verified' || status === 'active';
    });
    const allowedSet = new Set(
        allowedEmails.map((entry) => normalizeEmail(entry?.email_address || entry?.email || entry?.address))
    );

    let fromEmail = requestedFromEmail || process.env.CC_FROM_EMAIL || '';
    if (fromEmail && allowedSet.size > 0 && !allowedSet.has(normalizeEmail(fromEmail))) {
        fromEmail = pickFirstEmail(confirmedEmails) || pickFirstEmail(allowedEmails) || fromEmail;
    }
    if (!fromEmail) {
        fromEmail = pickFirstEmail(confirmedEmails) || pickFirstEmail(allowedEmails);
    }
    if (!fromEmail) {
        const error = new Error('CC_FROM_EMAIL not configured');
        error.statusCode = 500;
        throw error;
    }

    const fromName = process.env.CC_FROM_NAME || 'St Edmunds';
    const replyTo = process.env.CC_REPLY_TO_EMAIL || fromEmail;
    const normalizeEntryEmail = (entry) => normalizeEmail(entry?.email_address || entry?.email || entry?.address);
    const fromEntry = allowedEmails.find((entry) => normalizeEntryEmail(entry) === normalizeEmail(fromEmail));
    const replyEntry = allowedEmails.find((entry) => normalizeEntryEmail(entry) === normalizeEmail(replyTo));

    const baseActivity = {
        format_type: 'HTML',
        from_email: fromEmail,
        from_name: fromName,
        reply_to_email: replyTo,
        subject,
        html_content: html,
        contact_list_ids: [listId]
    };
    if (fromEntry?.email_id) {
        baseActivity.from_email_id = fromEntry.email_id;
    }
    if (replyEntry?.email_id) {
        baseActivity.reply_to_email_id = replyEntry.email_id;
    }

    const campaignPayload = {
        name: campaignName,
        email_campaign_activities: [baseActivity]
    };

    let campaign;
    try {
        campaign = await fetchCcJson(`${CC_API_BASE}/emails`, tokens, {
            method: 'POST',
            body: JSON.stringify(campaignPayload)
        });
    } catch (error) {
        console.error('Constant Contact create payload fallback:', campaignPayload);
        campaign = await fetchCcJson(`${CC_API_BASE}/emails`, tokens, {
            method: 'POST',
            body: JSON.stringify({
                ...campaignPayload,
                email_campaign_activities: [
                    {
                        ...baseActivity,
                        html_content: minimalHtml
                    }
                ]
            })
        });
    }

    const activity = campaign?.email_campaign_activities?.[0];
    const activityId = activity?.activity_id;
    if (!activityId) {
        const error = new Error('Failed to create Constant Contact email activity');
        error.statusCode = 500;
        throw error;
    }

    const attachedLists = Array.isArray(activity?.contact_list_ids) ? activity.contact_list_ids : [];
    if (!attachedLists.includes(listId)) {
        await fetchCcJson(`${CC_API_BASE}/emails/activities/${activityId}/contact_lists`, tokens, {
            method: 'POST',
            body: JSON.stringify({ contact_list_ids: [listId] })
        });
    }

    const scheduledDate = getNextSaturdayAtSix().toISOString();
    await fetchCcJson(`${CC_API_BASE}/emails/activities/${activityId}/schedules`, tokens, {
        method: 'POST',
        body: JSON.stringify({ scheduled_date: scheduledDate })
    });

    return {
        success: true,
        activityId,
        scheduledDate
    };
};

export const __TEST__ = {
    validateEmailInput
};

