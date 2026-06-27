import { useEffect, useRef, useState } from 'react';
import Card from '../Card';
import { API_URL } from '../../services/apiConfig';

const AP_ROUTE_KIND_OPTIONS = [
    { value: 'BILL', label: 'Invoice (BILL)' },
    { value: 'DB', label: 'Debit (DB)' },
    { value: 'EFT', label: 'Electronic Transfer (EFT)' },
    { value: 'CHECK', label: 'Check (Check)' }
];

const DEFAULT_SHARED_ALLOCATION = {
    shared: false,
    churchAllocationPercent: '50',
    schoolAllocationPercent: '50'
};

const EMPTY_ANALYSIS = {
    vendor: '',
    vendorFound: false,
    vendorConfidence: 0,
    amount: ''
};

const buildEmptyDraft = () => ({
    routeKind: 'BILL',
    codeValue: '',
    vendor: '',
    amount: '',
    ...DEFAULT_SHARED_ALLOCATION
});

const normalizeAmountInput = (value) => {
    const raw = String(value || '').replace(/\$/g, '').replace(/,/g, '').trim();
    if (!raw) return '';
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return '';
    return parsed.toFixed(2);
};

const normalizePercentInput = (value) => {
    const raw = String(value ?? '').replace(/%/g, '').trim();
    if (!raw) return '';
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return '';
    return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/\.?0+$/, '');
};

const clampPercentValue = (value) => {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return Math.round(value * 100) / 100;
};

const formatPercentLabel = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.?0+$/, '');
};

const buildSharedNoteText = ({ shared, churchAllocationPercent, schoolAllocationPercent }) => {
    if (!shared) return '';
    const churchShare = Number(churchAllocationPercent);
    const schoolShare = Number(schoolAllocationPercent);
    if (!Number.isFinite(churchShare) || !Number.isFinite(schoolShare)) return 'SHARED';
    if (Math.abs(churchShare - 50) <= 0.01 && Math.abs(schoolShare - 50) <= 0.01) {
        return 'SHARED';
    }
    return `SHARED - ${formatPercentLabel(churchShare)}% Church, ${formatPercentLabel(schoolShare)}% School`;
};

const validateSharedAllocationDraft = ({ shared, churchAllocationPercent, schoolAllocationPercent }) => {
    if (!shared) {
        return {
            ok: true,
            shared: false,
            churchAllocationPercent: '50',
            schoolAllocationPercent: '50'
        };
    }

    const churchValue = Number.parseFloat(String(churchAllocationPercent ?? '').trim());
    const schoolValue = Number.parseFloat(String(schoolAllocationPercent ?? '').trim());
    if (!Number.isFinite(churchValue) || !Number.isFinite(schoolValue)) {
        return { ok: false, error: 'Enter both Church and School allocation percentages.' };
    }
    if (churchValue < 0 || churchValue > 100 || schoolValue < 0 || schoolValue > 100) {
        return { ok: false, error: 'Allocation percentages must stay between 0 and 100.' };
    }
    if (Math.abs((churchValue + schoolValue) - 100) > 0.01) {
        return { ok: false, error: 'Church and School allocations must total 100%.' };
    }

    return {
        ok: true,
        shared: true,
        churchAllocationPercent: normalizePercentInput(churchValue),
        schoolAllocationPercent: normalizePercentInput(schoolValue)
    };
};

const buildComplementaryAllocationUpdate = (field, rawValue) => {
    const cleaned = String(rawValue ?? '').replace(/%/g, '').trim();
    const parsed = cleaned ? Number.parseFloat(cleaned) : 0;
    const primaryValue = clampPercentValue(parsed);
    const secondaryValue = clampPercentValue(100 - primaryValue);
    const normalizedPrimary = normalizePercentInput(primaryValue) || '0';
    const normalizedSecondary = normalizePercentInput(secondaryValue) || '0';

    if (field === 'schoolAllocationPercent') {
        return {
            schoolAllocationPercent: normalizedPrimary,
            churchAllocationPercent: normalizedSecondary
        };
    }

    return {
        churchAllocationPercent: normalizedPrimary,
        schoolAllocationPercent: normalizedSecondary
    };
};

const isPdfFile = (file) => {
    if (!file) return false;
    if (String(file.type || '').toLowerCase() === 'application/pdf') return true;
    return String(file.name || '').toLowerCase().endsWith('.pdf');
};

const readJson = async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload;
};

const decodeBase64ToBlob = (base64) => {
    const binary = window.atob(String(base64 || ''));
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: 'application/pdf' });
};

const formatSizeLabel = (sizeBytes) => {
    const size = Number(sizeBytes || 0);
    if (!Number.isFinite(size) || size <= 0) return 'PDF preview appears here after upload.';
    return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const buildBudgetCategoryGroups = (entries = []) => {
    const groups = [];
    const byCategory = new Map();
    entries.forEach((entry, index) => {
        const type = String(entry?.type || '').toLowerCase();
        const category = String(entry?.category || '').trim();
        if (!category) return;
        if (!byCategory.has(category)) {
            const next = { category, entries: [] };
            byCategory.set(category, next);
            groups.push(next);
        }
        const bucket = byCategory.get(category);
        if (type === 'heading') {
            const label = String(entry?.label || '').trim();
            if (label) {
                bucket.entries.push({
                    type: 'heading',
                    label,
                    key: `heading:${category}:${index}:${label}`
                });
            }
            return;
        }
        if (type !== 'item') return;
        const code = String(entry?.code || '').trim();
        if (!code) return;
        bucket.entries.push({
            type: 'item',
            code,
            line: String(entry?.line || '').trim(),
            key: `item:${category}:${index}:${code}`
        });
    });
    return groups;
};

const PdfRoutingPanel = ({ onRouted, onDismissEmailIntent, emailRoutingIntent = null }) => {
    const fileInputRef = useRef(null);
    const hydratedEmailIntentKeyRef = useRef('');
    const [budgetEntries, setBudgetEntries] = useState([]);
    const [loadingCodes, setLoadingCodes] = useState(true);
    const [selectedFile, setSelectedFile] = useState(null);
    const [emailSource, setEmailSource] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
    const [draft, setDraft] = useState(buildEmptyDraft);
    const [dragActive, setDragActive] = useState(false);
    const [busy, setBusy] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const loadCodes = async () => {
            setLoadingCodes(true);
            try {
                const payload = await readJson(await fetch(`${API_URL}/sharefile/budget-codes`));
                if (!cancelled) {
                    setBudgetEntries(Array.isArray(payload.entries) ? payload.entries : []);
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError?.message || 'Failed to load budget codes');
                }
            } finally {
                if (!cancelled) {
                    setLoadingCodes(false);
                }
            }
        };
        void loadCodes();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
    }, [previewUrl]);

    useEffect(() => {
        const messageId = String(emailRoutingIntent?.messageId || '').trim();
        const threadId = String(emailRoutingIntent?.threadId || '').trim();
        const intentKey = messageId || threadId
            ? JSON.stringify({
                messageId,
                threadId,
                routeKind: String(emailRoutingIntent?.routeKind || '').trim(),
                codeValue: String(emailRoutingIntent?.codeValue || '').trim()
            })
            : '';
        if (!intentKey || hydratedEmailIntentKeyRef.current === intentKey) return undefined;

        hydratedEmailIntentKeyRef.current = intentKey;
        let cancelled = false;

        const loadEmailPreview = async () => {
            setPreviewLoading(true);
            setNotice('');
            setError('');
            try {
                const payload = await readJson(await fetch(`${API_URL}/sharefile/email-routing-preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        gmail: {
                            messageId,
                            threadId
                        },
                        routeKind: String(emailRoutingIntent?.routeKind || 'BILL').trim() || 'BILL',
                        codeValue: String(emailRoutingIntent?.codeValue || '').trim(),
                        vendor: String(emailRoutingIntent?.vendor || '').trim(),
                        amount: String(emailRoutingIntent?.amount || '').trim(),
                        client: {
                            ts: new Date().toISOString()
                        }
                    })
                }));
                if (cancelled) return;

                const blob = decodeBase64ToBlob(payload?.preview?.pdfBase64 || '');
                const nextPreviewUrl = URL.createObjectURL(blob);
                setPreviewUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return nextPreviewUrl;
                });
                setSelectedFile(null);
                setEmailSource({
                    fileName: String(payload?.preview?.fileName || 'email-preview.pdf').trim() || 'email-preview.pdf',
                    sizeBytes: blob.size,
                    source: String(payload?.preview?.source || 'rendered-email').trim() || 'rendered-email',
                    attachmentCount: Number(payload?.preview?.attachmentCount || 0) || 0,
                    messageId: String(payload?.resolved?.messageId || payload?.preview?.messageId || messageId).trim(),
                    threadId: String(payload?.resolved?.threadId || payload?.preview?.threadId || threadId).trim()
                });
                setAnalysis({
                    vendor: String(payload?.analysis?.vendor || '').trim(),
                    vendorFound: Boolean(payload?.analysis?.vendorFound),
                    vendorConfidence: Number(payload?.analysis?.vendorConfidence || 0) || 0,
                    amount: String(payload?.analysis?.amount || '').trim()
                });
                setDraft((prev) => ({
                    ...prev,
                    routeKind: String(payload?.draft?.routeKind || emailRoutingIntent?.routeKind || prev.routeKind).trim() || 'BILL',
                    codeValue: String(payload?.draft?.codeValue || emailRoutingIntent?.codeValue || prev.codeValue).trim(),
                    vendor: String(payload?.draft?.vendor || payload?.analysis?.vendor || prev.vendor).trim(),
                    amount: String(payload?.draft?.amount || payload?.analysis?.amount || prev.amount).trim(),
                    shared: Boolean(payload?.draft?.shared),
                    churchAllocationPercent: String(payload?.draft?.churchAllocationPercent || prev.churchAllocationPercent || '50'),
                    schoolAllocationPercent: String(payload?.draft?.schoolAllocationPercent || prev.schoolAllocationPercent || '50')
                }));
                setNotice('Loaded Gmail invoice preview in the finance router.');
            } catch (previewError) {
                if (!cancelled) {
                    setError(previewError?.message || 'Failed to load Gmail preview');
                }
            } finally {
                if (!cancelled) {
                    setPreviewLoading(false);
                }
            }
        };

        void loadEmailPreview();
        return () => {
            cancelled = true;
        };
    }, [emailRoutingIntent]);

    const budgetCategoryGroups = buildBudgetCategoryGroups(budgetEntries);

    const clearFileSelection = ({ notifyIntentDismiss = true } = {}) => {
        const hadEmailIntent = Boolean(emailSource || emailRoutingIntent);
        hydratedEmailIntentKeyRef.current = '';
        setSelectedFile(null);
        setEmailSource(null);
        setAnalysis(EMPTY_ANALYSIS);
        setDraft(buildEmptyDraft());
        setNotice('');
        setError('');
        setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return '';
        });
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        if (hadEmailIntent && notifyIntentDismiss) {
            onDismissEmailIntent?.();
        }
    };

    const analyzeFile = async (file, routeKind) => {
        setAnalyzing(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('routeKind', routeKind);
            const payload = await readJson(await fetch(`${API_URL}/sharefile/analyze-pdf`, {
                method: 'POST',
                body: formData
            }));
            const nextAnalysis = {
                vendor: String(payload?.analysis?.vendor || '').trim(),
                vendorFound: Boolean(payload?.analysis?.vendorFound),
                vendorConfidence: Number(payload?.analysis?.vendorConfidence || 0) || 0,
                amount: String(payload?.analysis?.amount || '').trim()
            };
            setAnalysis(nextAnalysis);
            setDraft((prev) => ({
                ...prev,
                vendor: nextAnalysis.vendor || prev.vendor,
                amount: nextAnalysis.amount || prev.amount
            }));
        } catch (analyzeError) {
            setAnalysis(EMPTY_ANALYSIS);
            setError(analyzeError?.message || 'Failed to analyze PDF');
        } finally {
            setAnalyzing(false);
        }
    };

    const acceptFile = async (file) => {
        if (!isPdfFile(file)) {
            setError('Choose a PDF invoice.');
            return;
        }
        setNotice('');
        setError('');
        setSelectedFile(file);
        setEmailSource(null);
        setAnalysis(EMPTY_ANALYSIS);
        setDraft((prev) => ({
            ...prev,
            vendor: '',
            amount: ''
        }));
        setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
        });
        await analyzeFile(file, draft.routeKind);
    };

    const handleFileInputChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await acceptFile(file);
    };

    const handleDrop = async (event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        await acceptFile(file);
    };

    const handleRouteKindChange = async (value) => {
        setDraft((prev) => ({ ...prev, routeKind: value }));
        if (selectedFile) {
            await analyzeFile(selectedFile, value);
        }
    };

    const handleSharedToggleChange = (checked) => {
        setDraft((prev) => ({
            ...prev,
            shared: checked,
            churchAllocationPercent: checked ? (prev.churchAllocationPercent || '50') : '50',
            schoolAllocationPercent: checked ? (prev.schoolAllocationPercent || '50') : '50'
        }));
    };

    const handleSharedAllocationChange = (field, rawValue) => {
        setDraft((prev) => ({
            ...prev,
            ...buildComplementaryAllocationUpdate(field, rawValue)
        }));
    };

    const handleRoute = async () => {
        const hasPreview = Boolean(selectedFile || emailSource);
        if (!hasPreview) {
            setError('Choose a PDF invoice first.');
            return;
        }

        const codeValue = String(draft.codeValue || '').trim();
        if (!codeValue) {
            setError('Budget code is required.');
            return;
        }

        const vendor = String(draft.vendor || '').trim();
        if (!vendor) {
            setError('Vendor is required.');
            return;
        }

        const sharedMeta = validateSharedAllocationDraft(draft);
        if (!sharedMeta.ok) {
            setError(sharedMeta.error || 'Shared allocation is invalid.');
            return;
        }

        setBusy(true);
        setNotice('');
        setError('');
        try {
            let payload;
            if (emailSource) {
                payload = await readJson(await fetch(`${API_URL}/sharefile/route-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        codeType: 'budget',
                        codeValue,
                        routeKind: draft.routeKind,
                        vendor,
                        amount: normalizeAmountInput(draft.amount),
                        shared: sharedMeta.shared,
                        churchAllocationPercent: sharedMeta.churchAllocationPercent,
                        schoolAllocationPercent: sharedMeta.schoolAllocationPercent,
                        gmail: {
                            messageId: emailSource.messageId,
                            threadId: emailSource.threadId
                        },
                        client: {
                            ts: new Date().toISOString()
                        }
                    })
                }));
                clearFileSelection({ notifyIntentDismiss: false });
                setNotice(`Routed Gmail invoice to code ${codeValue}.`);
                onRouted?.(payload, { sourceMode: 'email' });
            } else {
                const formData = new FormData();
                formData.append('file', selectedFile);
                formData.append('routeKind', draft.routeKind);
                formData.append('codeValue', codeValue);
                formData.append('vendor', vendor);
                formData.append('amount', normalizeAmountInput(draft.amount));
                formData.append('shared', String(sharedMeta.shared));
                formData.append('churchAllocationPercent', sharedMeta.churchAllocationPercent);
                formData.append('schoolAllocationPercent', sharedMeta.schoolAllocationPercent);
                payload = await readJson(await fetch(`${API_URL}/sharefile/route-pdf`, {
                    method: 'POST',
                    body: formData
                }));
                const routedFile = payload?.output?.files?.[0];
                clearFileSelection();
                setNotice(`Routed ${routedFile?.name || selectedFile.name} to code ${codeValue}.`);
                onRouted?.(payload, { sourceMode: 'upload' });
            }
        } catch (routeError) {
            setError(routeError?.message || 'Failed to route invoice');
        } finally {
            setBusy(false);
        }
    };

    const activeFileName = selectedFile?.name || emailSource?.fileName || 'No PDF selected';
    const activeSizeText = selectedFile
        ? formatSizeLabel(selectedFile.size)
        : emailSource
            ? `${formatSizeLabel(emailSource.sizeBytes)}${emailSource.source === 'rendered-email'
                ? ' from Gmail email render.'
                : ` from Gmail attachment${emailSource.attachmentCount > 1 ? ` (${emailSource.attachmentCount} attachments found)` : ''}.`}`
            : 'PDF preview appears here after upload.';
    const sharedNoteText = buildSharedNoteText(draft);

    return (
        <Card className="pdf-routing-card">
            <div className="pdf-routing-header">
                <div>
                    <h2>PDF Invoice Routing</h2>
                    <p>Drop a PDF or route a Gmail invoice preview here, confirm the coding, and send it directly into AP.</p>
                </div>
                <button
                    type="button"
                    className="pdf-routing-choose-button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy || previewLoading}
                >
                    Choose PDF
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    hidden
                    onChange={handleFileInputChange}
                />
            </div>

            <div className="pdf-routing-layout">
                <div
                    className={`pdf-routing-preview${dragActive ? ' is-drag-active' : ''}${previewUrl ? ' has-file' : ''}`}
                    onDragEnter={(event) => {
                        event.preventDefault();
                        setDragActive(true);
                    }}
                    onDragOver={(event) => {
                        event.preventDefault();
                        setDragActive(true);
                    }}
                    onDragLeave={(event) => {
                        event.preventDefault();
                        if (event.currentTarget.contains(event.relatedTarget)) return;
                        setDragActive(false);
                    }}
                    onDrop={handleDrop}
                >
                    {previewLoading ? (
                        <div className="pdf-routing-dropzone">
                            <strong>Loading Gmail preview...</strong>
                            <span>The finance router is preparing the email for review.</span>
                        </div>
                    ) : previewUrl ? (
                        <iframe title="Invoice PDF preview" src={previewUrl} className="pdf-routing-preview-frame" />
                    ) : (
                        <button
                            type="button"
                            className="pdf-routing-dropzone"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <strong>Drop invoice PDF</strong>
                            <span>or click to pick a file</span>
                        </button>
                    )}
                </div>

                <div className="pdf-routing-controls">
                    <div className="pdf-routing-file-meta">
                        <strong>{activeFileName}</strong>
                        <span>{activeSizeText}</span>
                    </div>

                    <div className="pdf-routing-analysis">
                        <div>
                            <span className="pdf-routing-analysis-label">Detected vendor</span>
                            <strong>{analysis.vendor || (analyzing || previewLoading ? 'Analyzing...' : 'Not found')}</strong>
                        </div>
                        <div>
                            <span className="pdf-routing-analysis-label">Detected amount</span>
                            <strong>{analysis.amount || (analyzing || previewLoading ? 'Analyzing...' : 'Not found')}</strong>
                        </div>
                        <div>
                            <span className="pdf-routing-analysis-label">Confidence</span>
                            <strong>{analysis.vendorFound ? `${Math.round(analysis.vendorConfidence * 100)}%` : 'n/a'}</strong>
                        </div>
                    </div>

                    <div className="pdf-routing-form">
                        <label>
                            Route type
                            <select
                                value={draft.routeKind}
                                onChange={(event) => void handleRouteKindChange(event.target.value)}
                            >
                                {AP_ROUTE_KIND_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Budget code
                            <select
                                value={draft.codeValue}
                                onChange={(event) => setDraft((prev) => ({ ...prev, codeValue: event.target.value }))}
                                disabled={loadingCodes || budgetCategoryGroups.length === 0}
                            >
                                <option value="">{loadingCodes ? 'Loading codes...' : 'Select budget code'}</option>
                                {budgetCategoryGroups.map((group) => (
                                    <optgroup key={group.category} label={group.category}>
                                        {group.entries.map((entry) => (
                                            entry.type === 'heading' ? (
                                                <option key={entry.key} value="" disabled>{`-- ${entry.label} --`}</option>
                                            ) : (
                                                <option key={entry.key} value={entry.code}>
                                                    {entry.line ? `${entry.code} - ${entry.line}` : entry.code}
                                                </option>
                                            )
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </label>
                        <label>
                            Vendor
                            <input
                                type="text"
                                value={draft.vendor}
                                onChange={(event) => setDraft((prev) => ({ ...prev, vendor: event.target.value }))}
                                placeholder="Vendor name"
                            />
                        </label>
                        <label>
                            Amount
                            <input
                                type="text"
                                inputMode="decimal"
                                value={draft.amount}
                                onChange={(event) => setDraft((prev) => ({ ...prev, amount: event.target.value }))}
                                onBlur={(event) => setDraft((prev) => ({ ...prev, amount: normalizeAmountInput(event.target.value) }))}
                                placeholder="0.00"
                            />
                        </label>
                    </div>

                    <div className="pdf-routing-shared-controls">
                        <label className="pdf-routing-shared-toggle">
                            <input
                                type="checkbox"
                                checked={draft.shared}
                                onChange={(event) => handleSharedToggleChange(event.target.checked)}
                            />
                            <span>Shared between Church and School</span>
                        </label>
                        {draft.shared ? (
                            <div className="pdf-routing-shared-grid">
                                <label>
                                    Church %
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={draft.churchAllocationPercent}
                                        onChange={(event) => handleSharedAllocationChange('churchAllocationPercent', event.target.value)}
                                        onBlur={(event) => handleSharedAllocationChange('churchAllocationPercent', event.target.value)}
                                    />
                                </label>
                                <label>
                                    School %
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={draft.schoolAllocationPercent}
                                        onChange={(event) => handleSharedAllocationChange('schoolAllocationPercent', event.target.value)}
                                        onBlur={(event) => handleSharedAllocationChange('schoolAllocationPercent', event.target.value)}
                                    />
                                </label>
                            </div>
                        ) : null}
                        {draft.shared ? (
                            <div className="pdf-routing-shared-note-preview">
                                <span className="pdf-routing-analysis-label">Approval note</span>
                                <strong>{sharedNoteText}</strong>
                            </div>
                        ) : null}
                    </div>

                    <div className="pdf-routing-actions">
                        <button
                            type="button"
                            className="pdf-routing-primary-button"
                            onClick={handleRoute}
                            disabled={busy || previewLoading || (!selectedFile && !emailSource)}
                        >
                            {busy ? 'Routing...' : (emailSource ? 'Route Gmail invoice' : 'Route invoice PDF')}
                        </button>
                        <button
                            type="button"
                            className="pdf-routing-secondary-button"
                            onClick={clearFileSelection}
                            disabled={busy || previewLoading || (!selectedFile && !emailSource && !previewUrl)}
                        >
                            Clear
                        </button>
                    </div>

                    {notice ? <div className="alert success">{notice}</div> : null}
                    {error ? <div className="alert error">{error}</div> : null}
                </div>
            </div>
        </Card>
    );
};

export default PdfRoutingPanel;
