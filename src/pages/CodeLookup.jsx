import { useEffect, useMemo, useRef, useState } from 'react';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import { formatCurrency } from '../utils/formatters';
import './CodeLookup.css';

const normalize = (value) => String(value || '').toLowerCase().trim();

const includesAllTokens = (text, query) => {
    const normalizedText = normalize(text);
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    return tokens.every((token) => normalizedText.includes(token));
};

const fetchJsonWithFallback = async (paths = []) => {
    let lastError = null;
    for (const path of paths) {
        try {
            const response = await fetch(path);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(String(payload?.error || `HTTP ${response.status}`));
            return payload;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Failed to fetch');
};

const formatPercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    return `${Math.round(numeric * 100)}%`;
};

const buildBudgetBarStyle = (ratio) => {
    if (!Number.isFinite(ratio)) {
        return {
            '--budget-bar-fill': '#94a3b8',
            '--budget-bar-track': '#e2e8f0',
            '--budget-bar-width': '0%'
        };
    }
    const bounded = Math.max(0, Math.min(ratio, 1.2));
    const hue = ratio >= 1 ? 4 : Math.round(120 - (bounded * 120));
    return {
        '--budget-bar-fill': `hsl(${hue} 72% 45%)`,
        '--budget-bar-track': `hsl(${hue} 74% 92%)`,
        '--budget-bar-width': `${Math.max(6, Math.min(ratio * 100, 100))}%`
    };
};

const formatBudgetStatus = (row) => {
    if (Number.isFinite(row?.annualBudget) && Number.isFinite(row?.currentActual)) {
        return `${formatCurrency(row.currentActual)} of ${formatCurrency(row.annualBudget)}`;
    }
    if (Number.isFinite(row?.codeTransactionActual) && row.codeTransactionActual > 0) {
        return `${formatCurrency(row.codeTransactionActual)} actual`;
    }
    return 'No budget mapping';
};

const formatDateLabel = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

const unique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const CodeLookup = () => {
    const [activeTab, setActiveTab] = useState('ap');
    const [query, setQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [budgetNotice, setBudgetNotice] = useState('');
    const [budgetEntries, setBudgetEntries] = useState([]);
    const [budgetOverview, setBudgetOverview] = useState({
        summary: null,
        snapshot: null,
        buckets: [],
        transactions: [],
        sources: { configured: [], discovered: [] }
    });
    const [envelopeEntries, setEnvelopeEntries] = useState([]);
    const [copied, setCopied] = useState('');
    const [budgetModalOpen, setBudgetModalOpen] = useState(false);
    const [budgetFocusCode, setBudgetFocusCode] = useState('');
    const [budgetActionBusy, setBudgetActionBusy] = useState('');
    const searchInputRef = useRef(null);

    const loadBudgetData = async () => {
        setBudgetNotice('');
        try {
            const payload = await fetchJsonWithFallback([
                `${API_URL}/budget/overview`,
                '/api/budget/overview'
            ]);
            if (!payload?.ok) throw new Error(payload?.error || 'Failed to load budget overview');
            setBudgetEntries(Array.isArray(payload.entries) ? payload.entries : []);
            setBudgetOverview({
                summary: payload.summary || null,
                snapshot: payload.snapshot || null,
                buckets: Array.isArray(payload.buckets) ? payload.buckets : [],
                transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
                sources: payload.sources || { configured: [], discovered: [] }
            });
            return;
        } catch (budgetError) {
            const fallbackPayload = await fetchJsonWithFallback([
                `${API_URL}/sharefile/budget-codes`,
                '/api/sharefile/budget-codes'
            ]);
            if (!fallbackPayload?.ok) {
                throw new Error(fallbackPayload?.error || budgetError?.message || 'Failed to load budget codes');
            }
            setBudgetEntries(
                (Array.isArray(fallbackPayload.entries) ? fallbackPayload.entries : [])
                    .filter((entry) => String(entry?.type || '').toLowerCase() === 'item')
            );
            setBudgetOverview({
                summary: null,
                snapshot: null,
                buckets: [],
                transactions: [],
                sources: { configured: [], discovered: [] }
            });
            setBudgetNotice('Budget overview is unavailable right now. Showing codes without budget progress.');
        }
    };

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            setLoading(true);
            setError('');
            try {
                const envelopePayload = await fetchJsonWithFallback([
                    `${API_URL}/sharefile/envelope-numbers`,
                    '/api/sharefile/envelope-numbers'
                ]);
                if (!envelopePayload?.ok) throw new Error(envelopePayload?.error || 'Failed to load envelope numbers');
                const envelopeItems = (Array.isArray(envelopePayload.entries) ? envelopePayload.entries : [])
                    .map((row) => ({
                        letter: String(row.letter || '').trim(),
                        number: String(row.number || '').trim(),
                        name: String(row.name || '').trim()
                    }))
                    .filter((row) => row.number)
                    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
                await loadBudgetData();
                if (!cancelled) {
                    setEnvelopeEntries(envelopeItems);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(String(err?.message || 'Failed to load code data'));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void run();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const onSlashFocus = (event) => {
            if (event.key !== '/') return;
            const target = event.target;
            const tag = String(target?.tagName || '').toLowerCase();
            const isEditable = target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
            if (isEditable) return;
            event.preventDefault();
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        };
        window.addEventListener('keydown', onSlashFocus);
        return () => window.removeEventListener('keydown', onSlashFocus);
    }, []);

    const apResults = useMemo(() => budgetEntries.filter((row) => includesAllTokens(
        `${row.code} ${row.line} ${row.category} ${row.bucketLabel || ''}`,
        query
    )), [budgetEntries, query]);

    const arResults = useMemo(() => envelopeEntries.filter((row) => includesAllTokens(
        `${row.number} ${row.name} ${row.letter}`,
        query
    )), [envelopeEntries, query]);

    const visibleResults = activeTab === 'ap' ? apResults : arResults;
    const totalCount = activeTab === 'ap' ? budgetEntries.length : envelopeEntries.length;

    useEffect(() => {
        setHighlightedIndex(visibleResults.length > 0 ? 0 : -1);
    }, [activeTab, query, visibleResults.length]);

    useEffect(() => {
        if (highlightedIndex < 0) return;
        const row = document.querySelector(`.code-lookup-row.is-active[data-row-index="${highlightedIndex}"]`);
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    }, [highlightedIndex, activeTab]);

    const handleCopy = async (value, copyKey) => {
        const text = String(value || '').trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(copyKey);
            window.setTimeout(() => setCopied((prev) => (prev === copyKey ? '' : prev)), 1200);
        } catch {
            setCopied('');
        }
    };

    const openBudgetModal = (code = '') => {
        setBudgetFocusCode(String(code || '').trim());
        setBudgetModalOpen(true);
    };

    const handleSearchKeyDown = (event) => {
        if (!visibleResults.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlightedIndex((prev) => {
                const next = prev < 0 ? 0 : prev + 1;
                return next >= visibleResults.length ? 0 : next;
            });
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedIndex((prev) => {
                if (prev < 0) return visibleResults.length - 1;
                const next = prev - 1;
                return next < 0 ? visibleResults.length - 1 : next;
            });
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const row = visibleResults[Math.max(0, highlightedIndex)];
            if (!row) return;
            if (activeTab === 'ap') openBudgetModal(row.code);
            else void handleCopy(row.number, `ar:${row.number}`);
        }
    };

    const focusedBudgetEntries = useMemo(() => (
        budgetFocusCode
            ? budgetEntries.filter((row) => String(row.code || '').trim() === budgetFocusCode)
            : budgetEntries
    ), [budgetEntries, budgetFocusCode]);

    const focusedBucketLabels = useMemo(() => unique(focusedBudgetEntries.map((row) => row.bucketLabel)), [focusedBudgetEntries]);

    const visibleBudgetBuckets = useMemo(() => (
        budgetFocusCode
            ? budgetOverview.buckets.filter((bucket) => focusedBucketLabels.includes(bucket.label))
            : budgetOverview.buckets
    ), [budgetFocusCode, budgetOverview.buckets, focusedBucketLabels]);

    const visibleBudgetTransactions = useMemo(() => (
        budgetFocusCode
            ? budgetOverview.transactions.filter((transaction) => (
                String(transaction.code || '').trim() === budgetFocusCode
                || focusedBucketLabels.includes(transaction.bucketLabel)
            ))
            : budgetOverview.transactions
    ), [budgetFocusCode, budgetOverview.transactions, focusedBucketLabels]);

    const handleAddBudgetFolder = async () => {
        setBudgetActionBusy('add');
        try {
            const pickResponse = await fetch(`${API_URL}/budget/sources/pick-folder`, { method: 'POST' });
            const pickPayload = await pickResponse.json().catch(() => ({}));
            if (!pickResponse.ok || !pickPayload?.ok) throw new Error(pickPayload?.error || 'Failed to pick folder');
            const path = String(pickPayload.path || '').trim();
            if (!path) return;
            const saveResponse = await fetch(`${API_URL}/budget/sources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const savePayload = await saveResponse.json().catch(() => ({}));
            if (!saveResponse.ok || !savePayload?.ok) throw new Error(savePayload?.error || 'Failed to save folder');
            await loadBudgetData();
        } catch (err) {
            setError(String(err?.message || 'Failed to add budget folder'));
        } finally {
            setBudgetActionBusy('');
        }
    };

    const handleToggleBudgetFolder = async (source) => {
        setBudgetActionBusy(`toggle:${source.id}`);
        try {
            const response = await fetch(`${API_URL}/budget/sources/${encodeURIComponent(source.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !source.enabled })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Failed to update source');
            await loadBudgetData();
        } catch (err) {
            setError(String(err?.message || 'Failed to update budget source'));
        } finally {
            setBudgetActionBusy('');
        }
    };

    const handleDeleteBudgetFolder = async (sourceId) => {
        setBudgetActionBusy(`delete:${sourceId}`);
        try {
            const response = await fetch(`${API_URL}/budget/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Failed to remove source');
            await loadBudgetData();
        } catch (err) {
            setError(String(err?.message || 'Failed to remove budget source'));
        } finally {
            setBudgetActionBusy('');
        }
    };

    return (
        <div className="page-codes">
            <div className="page-header-bar">
                <div className="page-header-title">
                    <p className="page-header-kicker">Finance Tools</p>
                    <h1>Code Lookup</h1>
                    <p className="page-header-subtitle">
                        Fast search for AP expense budget codes and AR envelope numbers. Press <kbd>/</kbd> to focus search.
                    </p>
                </div>
            </div>

            <Card className="code-lookup-card">
                <div className="code-lookup-controls">
                    <div className="code-lookup-tabs">
                        <button type="button" className={activeTab === 'ap' ? 'is-active' : ''} onClick={() => setActiveTab('ap')}>
                            AP Expense Codes
                        </button>
                        <button type="button" className={activeTab === 'ar' ? 'is-active' : ''} onClick={() => setActiveTab('ar')}>
                            AR Envelope Numbers
                        </button>
                    </div>
                    <div className="code-lookup-actions">
                        {activeTab === 'ap' && (
                            <button type="button" className="code-lookup-detail-btn" onClick={() => openBudgetModal('')}>
                                Budget details
                            </button>
                        )}
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            placeholder={activeTab === 'ap' ? 'Search code, line, category, or budget bucket...' : 'Search number, name, or letter...'}
                            className="code-lookup-search"
                        />
                    </div>
                </div>

                <div className="code-lookup-meta">
                    <span>{visibleResults.length} results</span>
                    <span>{totalCount} total</span>
                    {activeTab === 'ap' && budgetOverview.snapshot?.statementDateLabel && (
                        <span>Baseline: {budgetOverview.snapshot.statementDateLabel}</span>
                    )}
                </div>

                {loading && <p className="code-lookup-empty">Loading code lists...</p>}
                {!loading && error && <p className="code-lookup-error">{error}</p>}
                {!loading && !error && activeTab === 'ap' && budgetNotice && <p className="code-lookup-empty">{budgetNotice}</p>}
                {!loading && !error && visibleResults.length === 0 && <p className="code-lookup-empty">No matches. Try fewer search terms.</p>}
                {!loading && !error && visibleResults.length > 0 && (
                    <div className="code-lookup-table-wrap">
                        {activeTab === 'ap' ? (
                            <table className="code-lookup-table code-lookup-table-ap">
                                <thead>
                                    <tr>
                                        <th>Code</th>
                                        <th>Budget Line</th>
                                        <th>Category</th>
                                        <th>Budget vs Actual</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {apResults.map((row, index) => {
                                        const copyKey = `ap:${row.code}`;
                                        const progressStyle = buildBudgetBarStyle(row.progressRatio);
                                        return (
                                            <tr
                                                key={`${row.category}:${row.code}:${row.line}`}
                                                className={`code-lookup-row${index === highlightedIndex ? ' is-active' : ''}`}
                                                data-row-index={index}
                                                onClick={() => openBudgetModal(row.code)}
                                            >
                                                <td>
                                                    <button
                                                        type="button"
                                                        className={`code-copy-btn ${copied === copyKey ? 'is-copied' : ''}`}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            void handleCopy(row.code, copyKey);
                                                        }}
                                                        title="Copy code"
                                                    >
                                                        {row.code}
                                                    </button>
                                                </td>
                                                <td>
                                                    <div className="code-lookup-line-cell">
                                                        <strong>{row.line || '-'}</strong>
                                                        {row.bucketLabel && (
                                                            <span className="code-lookup-bucket-label">
                                                                {row.bucketMappingType === 'line' ? row.bucketLabel : `Budget bucket: ${row.bucketLabel}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>{row.category || '-'}</td>
                                                <td>
                                                    <div className="budget-status-cell">
                                                        <div className="budget-status-topline">
                                                            <strong>{formatBudgetStatus(row)}</strong>
                                                            {Number.isFinite(row.progressRatio) && (
                                                                <span className="budget-status-percent">{formatPercent(row.progressRatio)}</span>
                                                            )}
                                                        </div>
                                                        <div className="budget-progress-track" style={progressStyle}>
                                                            <span className="budget-progress-fill" />
                                                        </div>
                                                        <div className="budget-status-meta">
                                                            {Number.isFinite(row.variance) ? (
                                                                <span>{row.variance >= 0 ? `${formatCurrency(row.variance)} remaining` : `${formatCurrency(Math.abs(row.variance))} over`}</span>
                                                            ) : (
                                                                <span>No mapped annual budget</span>
                                                            )}
                                                            {(row.bucketParsedTransactionCount || row.bucketUnresolvedTransactionCount) > 0 && (
                                                                <span>
                                                                    +{row.bucketParsedTransactionCount || 0} parsed
                                                                    {row.bucketUnresolvedTransactionCount ? `, ${row.bucketUnresolvedTransactionCount} unresolved` : ''}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <table className="code-lookup-table">
                                <thead>
                                    <tr>
                                        <th>Envelope</th>
                                        <th>Name</th>
                                        <th>Letter</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {arResults.map((row, index) => {
                                        const copyKey = `ar:${row.number}`;
                                        return (
                                            <tr
                                                key={`${row.number}:${row.name}`}
                                                className={`code-lookup-row${index === highlightedIndex ? ' is-active' : ''}`}
                                                data-row-index={index}
                                            >
                                                <td>
                                                    <button
                                                        type="button"
                                                        className={`code-copy-btn ${copied === copyKey ? 'is-copied' : ''}`}
                                                        onClick={() => handleCopy(row.number, copyKey)}
                                                        title="Copy envelope number"
                                                    >
                                                        {row.number}
                                                    </button>
                                                </td>
                                                <td>{row.name || '-'}</td>
                                                <td>{row.letter || '-'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </Card>

            <Modal
                isOpen={budgetModalOpen}
                onClose={() => setBudgetModalOpen(false)}
                title={budgetFocusCode ? `Budget detail: ${budgetFocusCode}` : 'Budget detail'}
                className="modal-large budget-detail-modal"
            >
                <div className="budget-detail-layout">
                    <div className="budget-summary-grid">
                        <div className="budget-summary-card">
                            <span>Annual budget tracked</span>
                            <strong>{formatCurrency(budgetOverview.summary?.annualBudget)}</strong>
                        </div>
                        <div className="budget-summary-card">
                            <span>Current actual tracked</span>
                            <strong>{formatCurrency(budgetOverview.summary?.currentActual)}</strong>
                        </div>
                        <div className="budget-summary-card">
                            <span>Over-budget buckets</span>
                            <strong>{budgetOverview.summary?.overBudgetCount ?? 0}</strong>
                        </div>
                        <div className="budget-summary-card">
                            <span>Unresolved transactions</span>
                            <strong>{budgetOverview.summary?.unresolvedTransactions ?? 0}</strong>
                        </div>
                    </div>

                    <div className="budget-detail-section">
                        <div className="budget-detail-section-header">
                            <div>
                                <h4>Snapshot</h4>
                                <p>
                                    {budgetOverview.snapshot?.statementDateLabel
                                        ? `Budget baseline from ${budgetOverview.snapshot.statementDateLabel}.`
                                        : 'No budget snapshot loaded.'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="budget-detail-section">
                        <div className="budget-detail-section-header">
                            <div>
                                <h4>Historical Folder Sources</h4>
                                <p>Configured folders are scanned in addition to dashboard-routed AP files.</p>
                            </div>
                            <button
                                type="button"
                                className="code-lookup-detail-btn"
                                onClick={handleAddBudgetFolder}
                                disabled={budgetActionBusy === 'add'}
                            >
                                {budgetActionBusy === 'add' ? 'Adding...' : 'Add folder'}
                            </button>
                        </div>

                        <div className="budget-source-list">
                            {Array.isArray(budgetOverview.sources?.configured) && budgetOverview.sources.configured.length > 0 ? (
                                budgetOverview.sources.configured.map((source) => (
                                    <div key={source.id} className="budget-source-item">
                                        <div className="budget-source-copy">
                                            <strong>{source.label}</strong>
                                            <span>{source.path}</span>
                                        </div>
                                        <div className="budget-source-actions">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleBudgetFolder(source)}
                                                disabled={budgetActionBusy === `toggle:${source.id}`}
                                            >
                                                {source.enabled ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                type="button"
                                                className="is-danger"
                                                onClick={() => handleDeleteBudgetFolder(source.id)}
                                                disabled={budgetActionBusy === `delete:${source.id}`}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="code-lookup-empty">No custom history folders added yet.</p>
                            )}
                        </div>

                        {Array.isArray(budgetOverview.sources?.discovered) && budgetOverview.sources.discovered.length > 0 && (
                            <div className="budget-source-list discovered">
                                <h5>Auto-discovered dashboard folders</h5>
                                {budgetOverview.sources.discovered.map((source) => (
                                    <div key={source.id} className="budget-source-item read-only">
                                        <div className="budget-source-copy">
                                            <strong>{source.label}</strong>
                                            <span>{source.path}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="budget-detail-section">
                        <div className="budget-detail-section-header">
                            <div>
                                <h4>Budget Buckets</h4>
                                <p>
                                    {budgetFocusCode
                                        ? `Buckets mapped to code ${budgetFocusCode}.`
                                        : 'Annual budget buckets parsed from the budget-vs-actuals report.'}
                                </p>
                            </div>
                        </div>

                        <div className="code-lookup-table-wrap budget-detail-table-wrap">
                            <table className="code-lookup-table">
                                <thead>
                                    <tr>
                                        <th>Bucket</th>
                                        <th>Annual Budget</th>
                                        <th>Snapshot Actual</th>
                                        <th>New Spend</th>
                                        <th>Current Actual</th>
                                        <th>Progress</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleBudgetBuckets.map((bucket) => (
                                        <tr key={bucket.label}>
                                            <td>
                                                <div className="code-lookup-line-cell">
                                                    <strong>{bucket.label}</strong>
                                                    {bucket.isTotal ? <span className="code-lookup-bucket-label">Summary bucket</span> : null}
                                                </div>
                                            </td>
                                            <td>{formatCurrency(bucket.annualBudget)}</td>
                                            <td>{formatCurrency(bucket.actualYtd)}</td>
                                            <td>{formatCurrency(bucket.postSnapshotActual)}</td>
                                            <td>{formatCurrency(bucket.currentActual)}</td>
                                            <td>
                                                <div className="budget-status-cell compact">
                                                    <div className="budget-progress-track" style={buildBudgetBarStyle(bucket.progressRatio)}>
                                                        <span className="budget-progress-fill" />
                                                    </div>
                                                    <div className="budget-status-meta">
                                                        <span>{formatPercent(bucket.progressRatio)}</span>
                                                        <span>{bucket.unresolvedTransactionCount || 0} unresolved</span>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="budget-detail-section">
                        <div className="budget-detail-section-header">
                            <div>
                                <h4>Transactions</h4>
                                <p>
                                    {budgetFocusCode
                                        ? `Recent transactions linked to code ${budgetFocusCode} or its mapped budget bucket.`
                                        : 'Recent dashboard and folder-scanned budget transactions.'}
                                </p>
                            </div>
                        </div>

                        <div className="code-lookup-table-wrap budget-detail-table-wrap">
                            <table className="code-lookup-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Code</th>
                                        <th>Vendor</th>
                                        <th>Amount</th>
                                        <th>Source</th>
                                        <th>Bucket</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleBudgetTransactions.map((transaction) => (
                                        <tr key={transaction.id}>
                                            <td>{formatDateLabel(transaction.dateIso)}</td>
                                            <td>{transaction.code || '-'}</td>
                                            <td>{transaction.vendor || transaction.fileName || '-'}</td>
                                            <td>{transaction.amount != null ? formatCurrency(transaction.amount) : 'Unresolved'}</td>
                                            <td>{transaction.sourceLabel || transaction.sourceType}</td>
                                            <td>{transaction.bucketLabel || 'Unmapped'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default CodeLookup;
