import { useEffect, useRef, useState } from 'react';
import Card from '../Card';
import { API_URL } from '../../services/apiConfig';

const AP_ROUTE_KIND_OPTIONS = [
    { value: 'BILL', label: 'Invoice (BILL)' },
    { value: 'DB', label: 'Debit (DB)' },
    { value: 'EFT', label: 'Electronic Transfer (EFT)' },
    { value: 'CHECK', label: 'Check (Check)' }
];

const normalizeAmountInput = (value) => {
    const raw = String(value || '').replace(/\$/g, '').replace(/,/g, '').trim();
    if (!raw) return '';
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return '';
    return parsed.toFixed(2);
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

const EMPTY_ANALYSIS = {
    vendor: '',
    vendorFound: false,
    vendorConfidence: 0,
    amount: ''
};

const PdfRoutingPanel = ({ onRouted }) => {
    const fileInputRef = useRef(null);
    const [budgetEntries, setBudgetEntries] = useState([]);
    const [loadingCodes, setLoadingCodes] = useState(true);
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
    const [draft, setDraft] = useState({
        routeKind: 'BILL',
        codeValue: '',
        vendor: '',
        amount: ''
    });
    const [dragActive, setDragActive] = useState(false);
    const [busy, setBusy] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const loadCodes = async () => {
            setLoadingCodes(true);
            try {
                const payload = await readJson(await fetch(`${API_URL}/sharefile/budget-codes`));
                if (!cancelled) {
                    setBudgetEntries(
                        (Array.isArray(payload.entries) ? payload.entries : [])
                            .filter((entry) => String(entry?.type || '').toLowerCase() === 'item')
                    );
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

    const clearFileSelection = () => {
        setSelectedFile(null);
        setAnalysis(EMPTY_ANALYSIS);
        setDraft((prev) => ({
            ...prev,
            vendor: '',
            amount: ''
        }));
        setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return '';
        });
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const analyzeFile = async (file) => {
        setAnalyzing(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('routeKind', draft.routeKind);
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
        await analyzeFile(file);
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

    const handleRoute = async () => {
        if (!selectedFile) {
            setError('Choose a PDF invoice first.');
            return;
        }
        const codeValue = String(draft.codeValue || '').trim();
        if (!codeValue) {
            setError('Budget code is required.');
            return;
        }

        setBusy(true);
        setNotice('');
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('routeKind', draft.routeKind);
            formData.append('codeValue', codeValue);
            formData.append('vendor', String(draft.vendor || '').trim());
            formData.append('amount', normalizeAmountInput(draft.amount));
            const payload = await readJson(await fetch(`${API_URL}/sharefile/route-pdf`, {
                method: 'POST',
                body: formData
            }));
            const routedFile = payload?.output?.files?.[0];
            setNotice(`Routed ${routedFile?.name || selectedFile.name} to code ${codeValue}.`);
            clearFileSelection();
            onRouted?.(payload);
        } catch (routeError) {
            setError(routeError?.message || 'Failed to route PDF');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="pdf-routing-card">
            <div className="pdf-routing-header">
                <div>
                    <h2>PDF Invoice Routing</h2>
                    <p>Drop an invoice PDF here, confirm the coding, and route it directly into AP.</p>
                </div>
                <button
                    type="button"
                    className="pdf-routing-choose-button"
                    onClick={() => fileInputRef.current?.click()}
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
                    className={`pdf-routing-preview${dragActive ? ' is-drag-active' : ''}${selectedFile ? ' has-file' : ''}`}
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
                    {selectedFile && previewUrl ? (
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
                        <strong>{selectedFile?.name || 'No PDF selected'}</strong>
                        <span>{selectedFile ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB` : 'PDF preview appears here after upload.'}</span>
                    </div>

                    <div className="pdf-routing-analysis">
                        <div>
                            <span className="pdf-routing-analysis-label">Detected vendor</span>
                            <strong>{analysis.vendor || (analyzing ? 'Analyzing...' : 'Not found')}</strong>
                        </div>
                        <div>
                            <span className="pdf-routing-analysis-label">Detected amount</span>
                            <strong>{analysis.amount || (analyzing ? 'Analyzing...' : 'Not found')}</strong>
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
                                onChange={(event) => setDraft((prev) => ({ ...prev, routeKind: event.target.value }))}
                            >
                                {AP_ROUTE_KIND_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Budget code
                            <input
                                list="pdf-routing-budget-codes"
                                value={draft.codeValue}
                                onChange={(event) => setDraft((prev) => ({ ...prev, codeValue: event.target.value }))}
                                placeholder={loadingCodes ? 'Loading codes...' : 'Enter budget code'}
                            />
                            <datalist id="pdf-routing-budget-codes">
                                {budgetEntries.map((entry) => (
                                    <option key={`${entry.code}-${entry.line}`} value={String(entry.code || '')}>
                                        {entry.line ? `${entry.code} - ${entry.line}` : String(entry.code || '')}
                                    </option>
                                ))}
                            </datalist>
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

                    <div className="pdf-routing-actions">
                        <button
                            type="button"
                            className="pdf-routing-primary-button"
                            onClick={handleRoute}
                            disabled={busy || !selectedFile}
                        >
                            {busy ? 'Routing...' : 'Route invoice PDF'}
                        </button>
                        <button
                            type="button"
                            className="pdf-routing-secondary-button"
                            onClick={clearFileSelection}
                            disabled={busy || (!selectedFile && !previewUrl)}
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
