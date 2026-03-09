import { useEffect, useMemo, useRef, useState } from 'react';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
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
            if (!response.ok) {
                const message = String(payload?.error || `HTTP ${response.status}`);
                throw new Error(message);
            }
            return payload;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Failed to fetch');
};

const CodeLookup = () => {
    const [activeTab, setActiveTab] = useState('ap');
    const [query, setQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [budgetEntries, setBudgetEntries] = useState([]);
    const [envelopeEntries, setEnvelopeEntries] = useState([]);
    const [copied, setCopied] = useState('');
    const searchInputRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const [budgetPayload, envelopePayload] = await Promise.all([
                    fetchJsonWithFallback([
                        `${API_URL}/sharefile/budget-codes`,
                        '/api/sharefile/budget-codes'
                    ]),
                    fetchJsonWithFallback([
                        `${API_URL}/sharefile/envelope-numbers`,
                        '/api/sharefile/envelope-numbers'
                    ])
                ]);
                if (!budgetPayload?.ok) {
                    throw new Error(budgetPayload?.error || 'Failed to load budget codes');
                }
                if (!envelopePayload?.ok) {
                    throw new Error(envelopePayload?.error || 'Failed to load envelope numbers');
                }
                if (cancelled) return;
                const budgetItems = (Array.isArray(budgetPayload.entries) ? budgetPayload.entries : [])
                    .filter((row) => String(row?.type || '').toLowerCase() === 'item')
                    .map((row) => ({
                        category: String(row.category || '').trim(),
                        code: String(row.code || '').trim(),
                        line: String(row.line || '').trim()
                    }))
                    .filter((row) => row.code)
                    .sort((a, b) => a.code.localeCompare(b.code));
                const envelopeItems = (Array.isArray(envelopePayload.entries) ? envelopePayload.entries : [])
                    .map((row) => ({
                        letter: String(row.letter || '').trim(),
                        number: String(row.number || '').trim(),
                        name: String(row.name || '').trim()
                    }))
                    .filter((row) => row.number)
                    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
                setBudgetEntries(budgetItems);
                setEnvelopeEntries(envelopeItems);
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
        load();
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

    const apResults = useMemo(() => {
        return budgetEntries.filter((row) => includesAllTokens(`${row.code} ${row.line} ${row.category}`, query));
    }, [budgetEntries, query]);

    const arResults = useMemo(() => {
        return envelopeEntries.filter((row) => includesAllTokens(`${row.number} ${row.name} ${row.letter}`, query));
    }, [envelopeEntries, query]);

    const visibleResults = activeTab === 'ap' ? apResults : arResults;
    const totalCount = activeTab === 'ap' ? budgetEntries.length : envelopeEntries.length;

    useEffect(() => {
        setHighlightedIndex(visibleResults.length > 0 ? 0 : -1);
    }, [activeTab, query, visibleResults.length]);

    useEffect(() => {
        if (highlightedIndex < 0) return;
        const row = document.querySelector(`.code-lookup-row.is-active[data-row-index="${highlightedIndex}"]`);
        if (row && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex, activeTab]);

    const handleCopy = async (value, copyKey) => {
        const text = String(value || '').trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(copyKey);
            window.setTimeout(() => {
                setCopied((prev) => (prev === copyKey ? '' : prev));
            }, 1200);
        } catch {
            setCopied('');
        }
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
            if (activeTab === 'ap') {
                void handleCopy(row.code, `ap:${row.code}`);
            } else {
                void handleCopy(row.number, `ar:${row.number}`);
            }
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
                        <button
                            type="button"
                            className={activeTab === 'ap' ? 'is-active' : ''}
                            onClick={() => setActiveTab('ap')}
                        >
                            AP Expense Codes
                        </button>
                        <button
                            type="button"
                            className={activeTab === 'ar' ? 'is-active' : ''}
                            onClick={() => setActiveTab('ar')}
                        >
                            AR Envelope Numbers
                        </button>
                    </div>
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={activeTab === 'ap' ? 'Search code, line, or category...' : 'Search number, name, or letter...'}
                        className="code-lookup-search"
                    />
                </div>

                <div className="code-lookup-meta">
                    <span>{visibleResults.length} results</span>
                    <span>{totalCount} total</span>
                </div>

                {loading && <p className="code-lookup-empty">Loading code lists...</p>}
                {!loading && error && <p className="code-lookup-error">{error}</p>}
                {!loading && !error && visibleResults.length === 0 && (
                    <p className="code-lookup-empty">No matches. Try fewer search terms.</p>
                )}

                {!loading && !error && visibleResults.length > 0 && (
                    <div className="code-lookup-table-wrap">
                        {activeTab === 'ap' ? (
                            <table className="code-lookup-table">
                                <thead>
                                    <tr>
                                        <th>Code</th>
                                        <th>Budget Line</th>
                                        <th>Category</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {apResults.map((row, index) => {
                                        const copyKey = `ap:${row.code}`;
                                        return (
                                            <tr
                                                key={`${row.category}:${row.code}:${row.line}`}
                                                className={`code-lookup-row${index === highlightedIndex ? ' is-active' : ''}`}
                                                data-row-index={index}
                                            >
                                                <td>
                                                    <button
                                                        type="button"
                                                        className={`code-copy-btn ${copied === copyKey ? 'is-copied' : ''}`}
                                                        onClick={() => handleCopy(row.code, copyKey)}
                                                        title="Copy code"
                                                    >
                                                        {row.code}
                                                    </button>
                                                </td>
                                                <td>{row.line || '-'}</td>
                                                <td>{row.category || '-'}</td>
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
        </div>
    );
};

export default CodeLookup;
