import { useCallback, useEffect, useRef, useState } from 'react';
import { FaEdit, FaTrash } from 'react-icons/fa';
import Card from '../components/Card';
import DataPill from '../components/DataPill';
import PdfRoutingPanel from '../components/finance/PdfRoutingPanel';
import DepositWorkspace from '../components/tasks/DepositWorkspace';
import { API_URL } from '../services/apiConfig';
import { formatCurrency } from '../utils/formatters';
import './Finance.css';

const AP_ROUTE_KIND_OPTIONS = [
    { value: 'BILL', label: 'Invoice (BILL)' },
    { value: 'DB', label: 'Debit (DB)' },
    { value: 'EFT', label: 'Electronic Transfer (EFT)' },
    { value: 'CHECK', label: 'Check (Check)' }
];
const ROUTING_LOG_REFRESH_MS = 30 * 1000;

const normalizeAmountInput = (value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return '';
    return numeric.toFixed(2);
};

const normalizeApRouteKind = (value) => {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'DB') return 'DB';
    if (upper === 'EFT') return 'EFT';
    if (upper === 'CHECK') return 'CHECK';
    return 'BILL';
};

const getApRouteKindLabel = (value) => (
    AP_ROUTE_KIND_OPTIONS.find((option) => option.value === normalizeApRouteKind(value))?.label || 'Invoice (BILL)'
);

const formatDateKey = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateKey = (value) => {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date();
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const shiftDateKey = (value, deltaDays) => {
    const base = parseDateKey(value);
    base.setDate(base.getDate() + deltaDays);
    return formatDateKey(base);
};

const formatLogDate = (value) => {
    const date = parseDateKey(value);
    return date.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

const formatLogTime = (isoValue) => {
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

const Finance = () => {
    const [apDate, setApDate] = useState(() => formatDateKey(new Date()));
    const [arDate, setArDate] = useState(() => formatDateKey(new Date()));
    const [apLog, setApLog] = useState({ loading: false, error: '', notice: '', entries: [], revealBusyKey: '', designationBusyKey: '', attachBusyKey: '' });
    const [arLog, setArLog] = useState({ loading: false, error: '', notice: '', entries: [], revealBusyKey: '', designationBusyKey: '' });
    const [apEditingKey, setApEditingKey] = useState('');
    const [apEditDraft, setApEditDraft] = useState({ codeValue: '', vendor: '', routeKind: 'BILL', amount: '', files: {}, filePaths: {}, deleted: {} });
    const [arEditingKey, setArEditingKey] = useState('');
    const [arEditDraft, setArEditDraft] = useState({ codeValue: '', designation: '', files: {}, filePaths: {}, deleted: {} });
    const apAttachInputRef = useRef(null);
    const [apAttachTarget, setApAttachTarget] = useState(null);
    const apDateRef = useRef(apDate);
    const arDateRef = useRef(arDate);
    const routingLogLoadRequestRef = useRef({ ap: 0, ar: 0 });

    useEffect(() => {
        apDateRef.current = apDate;
    }, [apDate]);

    useEffect(() => {
        arDateRef.current = arDate;
    }, [arDate]);

    const getRoutingDateForType = (logType) => (logType === 'ap' ? apDateRef.current : arDateRef.current);
    const isCurrentRoutingDate = (logType, dateKey) => getRoutingDateForType(logType) === dateKey;

    const todayKey = formatDateKey(new Date());

    const loadRoutingLog = useCallback(async (type, dateKey, setState) => {
        const requestId = Number(routingLogLoadRequestRef.current[type] || 0) + 1;
        routingLogLoadRequestRef.current[type] = requestId;
        setState((prev) => ({
            ...prev,
            loading: true,
            error: '',
            notice: ''
        }));
        try {
            const response = await fetch(
                `${API_URL}/deposit-slip/routing-log?type=${encodeURIComponent(type)}&date=${encodeURIComponent(dateKey)}`
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'Failed to load routing log');
            }
            const latestDateKey = type === 'ap' ? apDateRef.current : arDateRef.current;
            if (routingLogLoadRequestRef.current[type] !== requestId || latestDateKey !== dateKey) {
                return;
            }
            setState((prev) => ({
                ...prev,
                loading: false,
                error: '',
                entries: Array.isArray(payload.entries) ? payload.entries : []
            }));
        } catch (error) {
            console.error('Routing log load error:', error);
            const latestDateKey = type === 'ap' ? apDateRef.current : arDateRef.current;
            if (routingLogLoadRequestRef.current[type] !== requestId || latestDateKey !== dateKey) {
                return;
            }
            setState((prev) => ({
                ...prev,
                loading: false,
                entries: [],
                error: error?.message || 'Failed to load routing log'
            }));
        }
    }, []);

    const handleRevealRoutedFile = async ({ jobId, fileIndex, setState, type, logType }) => {
        const actionDateKey = getRoutingDateForType(logType);
        const busyKey = `${jobId}:${fileIndex}`;
        setState((prev) => ({ ...prev, revealBusyKey: busyKey, error: '', notice: '' }));
        try {
            const response = await fetch(`${API_URL}/deposit-slip/routing-log/reveal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId, fileIndex })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                const detail = String(payload?.detail || '').trim();
                throw new Error(detail ? `${payload?.error || 'Failed to open file location'} (${detail})` : (payload?.error || 'Failed to open file location'));
            }
            if (!isCurrentRoutingDate(logType, actionDateKey)) {
                return;
            }
            setState((prev) => ({
                ...prev,
                revealBusyKey: '',
                notice: `${type} file location opened.`,
                error: ''
            }));
        } catch (error) {
            console.error('Routing file reveal error:', error);
            if (!isCurrentRoutingDate(logType, actionDateKey)) {
                return;
            }
            setState((prev) => ({
                ...prev,
                revealBusyKey: '',
                notice: '',
                error: error?.message || 'Failed to open file location'
            }));
        }
    };

    const startApInlineEdit = (entry) => {
        const key = String(entry.jobId || entry.id || '').trim();
        if (!key) return;
        const filesDraft = {};
        (Array.isArray(entry.files) ? entry.files : []).forEach((file) => {
            filesDraft[String(file.fileIndex)] = String(file.name || '');
        });
        setApEditingKey(key);
        setApEditDraft({
            codeValue: String(entry.codeValue || ''),
            vendor: String(entry.vendor || ''),
            routeKind: normalizeApRouteKind(entry.routeKind || ''),
            amount: normalizeAmountInput(entry.amount || ''),
            files: filesDraft,
            filePaths: (Array.isArray(entry.files) ? entry.files : []).reduce((acc, file) => {
                acc[String(file.fileIndex)] = String(file.path || '');
                return acc;
            }, {}),
            deleted: {}
        });
    };

    const cancelApInlineEdit = () => {
        setApEditingKey('');
        setApEditDraft({ codeValue: '', vendor: '', routeKind: 'BILL', amount: '', files: {}, filePaths: {}, deleted: {} });
    };

    const startArInlineEdit = (entry) => {
        const key = String(entry.jobId || entry.id || '').trim();
        if (!key) return;
        const filesDraft = {};
        (Array.isArray(entry.files) ? entry.files : []).forEach((file) => {
            filesDraft[String(file.fileIndex)] = String(file.name || '');
        });
        setArEditingKey(key);
        setArEditDraft({
            codeValue: String(entry.envelopeNumber || entry.codeValue || ''),
            designation: String(entry.designation || ''),
            files: filesDraft,
            filePaths: (Array.isArray(entry.files) ? entry.files : []).reduce((acc, file) => {
                acc[String(file.fileIndex)] = String(file.path || '');
                return acc;
            }, {}),
            deleted: {}
        });
    };

    const cancelArInlineEdit = () => {
        setArEditingKey('');
        setArEditDraft({ codeValue: '', designation: '', files: {}, filePaths: {}, deleted: {} });
    };

    const handleAttachApFile = ({ entry, file }) => {
        const key = String(entry.jobId || entry.id || '').trim();
        const fileIndex = Number(file?.fileIndex);
        if (!key || !Number.isInteger(fileIndex) || fileIndex < 0) return;
        setApAttachTarget({
            key,
            fileIndex,
            fileName: String(file?.name || ''),
            targetDir: String(entry?.targetDir || '')
        });
        if (apAttachInputRef.current) {
            apAttachInputRef.current.value = '';
            apAttachInputRef.current.click();
        }
    };

    const handleApAttachInputChange = async (event) => {
        const selectedFile = event?.target?.files?.[0];
        const target = apAttachTarget;
        if (!selectedFile || !target) return;
        const actionDateKey = getRoutingDateForType('ap');
        const key = String(target.key || '').trim();
        const fileIndex = Number(target.fileIndex);
        const fileKey = String(fileIndex);
        if (!key || !Number.isInteger(fileIndex) || fileIndex < 0) return;
        const busyKey = `${key}:${fileKey}`;
        setApLog((prev) => ({ ...prev, attachBusyKey: busyKey, error: '', notice: '' }));
        try {
            const formData = new FormData();
            formData.append('jobId', key);
            formData.append('fileIndex', String(fileIndex));
            formData.append('file', selectedFile);
            const response = await fetch(`${API_URL}/deposit-slip/routing-log/ap-entry/attach-upload`, {
                method: 'POST',
                body: formData
            });
            const rawText = await response.text();
            let payload = {};
            try {
                payload = rawText ? JSON.parse(rawText) : {};
            } catch {
                payload = {};
            }
            if (!response.ok || !payload?.ok) {
                const fallbackMessage = rawText ? String(rawText).slice(0, 180) : '';
                throw new Error(payload?.error || payload?.detail || `Failed to attach file (HTTP ${response.status})${fallbackMessage ? `: ${fallbackMessage}` : ''}`);
            }

            const selectedName = String(payload.selectedName || '').trim();
            const selectedPath = String(payload.selectedPath || '').trim();
            setApEditDraft((prev) => ({
                ...prev,
                files: {
                    ...(prev.files || {}),
                    [fileKey]: selectedName || String(prev.files?.[fileKey] || selectedFile?.name || '')
                },
                filePaths: {
                    ...(prev.filePaths || {}),
                    [fileKey]: selectedPath || String(prev.filePaths?.[fileKey] || '')
                },
                deleted: {
                    ...(prev.deleted || {}),
                    [fileKey]: false
                }
            }));

            if (!isCurrentRoutingDate('ap', actionDateKey)) {
                return;
            }
            setApLog((prev) => ({
                ...prev,
                attachBusyKey: '',
                notice: `Attached ${selectedName || selectedFile.name || 'selected file'} to this log row.`,
                error: '',
                entries: prev.entries.map((row) => {
                    const rowKey = String(row.jobId || row.id || '').trim();
                    if (rowKey !== key) return row;
                    return {
                        ...row,
                        files: Array.isArray(payload.files) ? payload.files : row.files
                    };
                })
            }));
        } catch (error) {
            console.error('AP attach file error:', error);
            if (!isCurrentRoutingDate('ap', actionDateKey)) {
                return;
            }
            setApLog((prev) => ({
                ...prev,
                attachBusyKey: '',
                notice: '',
                error: error?.message || 'Failed to attach file'
            }));
        } finally {
            setApAttachTarget(null);
            if (apAttachInputRef.current) {
                apAttachInputRef.current.value = '';
            }
        }
    };

    const saveApInlineEdit = async (entry) => {
        const key = String(entry.jobId || entry.id || '').trim();
        if (!key) return;
        const actionDateKey = getRoutingDateForType('ap');
        const codeValue = String(apEditDraft.codeValue || '').trim();
        const vendor = String(apEditDraft.vendor || '').trim();
        const routeKind = normalizeApRouteKind(apEditDraft.routeKind || '');
        const amount = normalizeAmountInput(apEditDraft.amount || '');
        if (!codeValue) {
            setApLog((prev) => ({ ...prev, error: 'Code cannot be empty.', notice: '' }));
            return;
        }
        setApLog((prev) => ({ ...prev, designationBusyKey: key, error: '', notice: '' }));
        try {
            const filesPayload = (Array.isArray(entry.files) ? entry.files : []).map((file) => ({
                fileIndex: file.fileIndex,
                name: String(apEditDraft.files?.[String(file.fileIndex)] ?? file.name ?? '').trim(),
                path: String(apEditDraft.filePaths?.[String(file.fileIndex)] ?? file.path ?? '').trim(),
                deleted: apEditDraft.deleted?.[String(file.fileIndex)] === true
            }));
            const response = await fetch(`${API_URL}/deposit-slip/routing-log/ap-entry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId: key,
                    codeValue,
                    vendor,
                    routeKind,
                    amount,
                    files: filesPayload
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'Failed to save AP entry');
            }
            const renamedFiles = Number(payload?.renamedFiles || 0);
            const deletedFiles = Number(payload?.deletedFiles || 0);
            if (!isCurrentRoutingDate('ap', actionDateKey)) {
                return;
            }
            setApLog((prev) => ({
                ...prev,
                designationBusyKey: '',
                notice: `AP entry updated${renamedFiles > 0 || deletedFiles > 0 ? ` (${renamedFiles > 0 ? `${renamedFiles} file renamed` : ''}${renamedFiles > 0 && deletedFiles > 0 ? '; ' : ''}${deletedFiles > 0 ? `${deletedFiles} file deleted` : ''})` : ''}.`,
                error: '',
                entries: prev.entries.map((row) => {
                    const rowKey = String(row.jobId || row.id || '').trim();
                    if (rowKey !== key) return row;
                    return {
                        ...row,
                        codeValue: String(payload.codeValue || codeValue),
                        vendor: String(payload.vendor || vendor),
                        routeKind: normalizeApRouteKind(payload.routeKind || routeKind),
                        amount: normalizeAmountInput(payload.amount || amount),
                        vendorMissing: !String(payload.vendor || vendor).trim(),
                        files: Array.isArray(payload.files) ? payload.files : row.files
                    };
                })
            }));
            cancelApInlineEdit();
        } catch (error) {
            console.error('AP inline save error:', error);
            if (!isCurrentRoutingDate('ap', actionDateKey)) {
                return;
            }
            setApLog((prev) => ({
                ...prev,
                designationBusyKey: '',
                notice: '',
                error: error?.message || 'Failed to save AP entry'
            }));
        }
    };

    const saveArInlineEdit = async (entry) => {
        const key = String(entry.jobId || entry.id || '').trim();
        if (!key) return;
        const actionDateKey = getRoutingDateForType('ar');
        const codeValue = String(arEditDraft.codeValue || '').trim();
        const designation = String(arEditDraft.designation || '').trim();
        if (!designation) {
            setArLog((prev) => ({ ...prev, error: 'Designation cannot be empty.', notice: '' }));
            return;
        }
        setArLog((prev) => ({ ...prev, designationBusyKey: key, error: '', notice: '' }));
        try {
            const filesPayload = (Array.isArray(entry.files) ? entry.files : []).map((file) => ({
                fileIndex: file.fileIndex,
                name: String(arEditDraft.files?.[String(file.fileIndex)] ?? file.name ?? '').trim(),
                path: String(arEditDraft.filePaths?.[String(file.fileIndex)] ?? file.path ?? '').trim(),
                deleted: arEditDraft.deleted?.[String(file.fileIndex)] === true
            }));
            const response = await fetch(`${API_URL}/deposit-slip/routing-log/ar-entry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId: key,
                    codeValue,
                    designation,
                    files: filesPayload
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'Failed to save AR entry');
            }
            const renamedFiles = Number(payload?.renamedFiles || 0);
            const deletedFiles = Number(payload?.deletedFiles || 0);
            if (!isCurrentRoutingDate('ar', actionDateKey)) {
                return;
            }
            setArLog((prev) => ({
                ...prev,
                designationBusyKey: '',
                notice: `AR entry updated${renamedFiles > 0 || deletedFiles > 0 ? ` (${renamedFiles > 0 ? `${renamedFiles} file renamed` : ''}${renamedFiles > 0 && deletedFiles > 0 ? '; ' : ''}${deletedFiles > 0 ? `${deletedFiles} file deleted` : ''})` : ''}.`,
                error: '',
                entries: prev.entries.map((row) => {
                    const rowKey = String(row.jobId || row.id || '').trim();
                    if (rowKey !== key) return row;
                    return {
                        ...row,
                        codeValue: String(payload.codeValue || codeValue),
                        envelopeNumber: String(payload.envelopeNumber || payload.codeValue || codeValue),
                        designation: String(payload.designation || designation),
                        isPledger: !!payload.isPledger,
                        files: Array.isArray(payload.files) ? payload.files : row.files
                    };
                })
            }));
            cancelArInlineEdit();
        } catch (error) {
            console.error('AR inline save error:', error);
            if (!isCurrentRoutingDate('ar', actionDateKey)) {
                return;
            }
            setArLog((prev) => ({
                ...prev,
                designationBusyKey: '',
                notice: '',
                error: error?.message || 'Failed to save AR entry'
            }));
        }
    };

    useEffect(() => {
        setApLog((prev) => ({ ...prev, revealBusyKey: '', designationBusyKey: '', attachBusyKey: '' }));
        loadRoutingLog('ap', apDate, setApLog);
        const timer = window.setInterval(() => {
            loadRoutingLog('ap', apDate, setApLog);
        }, ROUTING_LOG_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [apDate, loadRoutingLog]);

    useEffect(() => {
        setArLog((prev) => ({ ...prev, revealBusyKey: '', designationBusyKey: '' }));
        loadRoutingLog('ar', arDate, setArLog);
        const timer = window.setInterval(() => {
            loadRoutingLog('ar', arDate, setArLog);
        }, ROUTING_LOG_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [arDate, loadRoutingLog]);

    return (
        <div className="page-finance">
            <input
                ref={apAttachInputRef}
                type="file"
                accept=".pdf,application/pdf"
                style={{ display: 'none' }}
                onChange={handleApAttachInputChange}
            />
            <header className="finance-header page-header-bar">
                <div className="page-header-title">
                    <h1>Finance & Accounts</h1>
                    <p className="page-header-subtitle">Monitor AP and AR routing, build deposit packets, and handle print-ready finance workflows.</p>
                </div>
            </header>

            <PdfRoutingPanel onRouted={() => loadRoutingLog('ap', apDateRef.current, setApLog)} />

            <div className="routing-log-grid">
                <Card className="routing-log-card">
                    <div className="routing-log-header">
                        <div>
                            <h2>AP Email Routing</h2>
                            <p>Invoices and direct debits routed for the selected day.</p>
                        </div>
                        <div className="routing-log-date-controls">
                            <button
                                type="button"
                                onClick={() => setApDate((prev) => shiftDateKey(prev, -1))}
                            >
                                Previous day
                            </button>
                            <span>{formatLogDate(apDate)}</span>
                            <button
                                type="button"
                                onClick={() => setApDate((prev) => shiftDateKey(prev, 1))}
                                disabled={apDate >= todayKey}
                            >
                                Next day
                            </button>
                        </div>
                    </div>
                    <div className="routing-log-body">
                        {apLog.loading && <p className="text-muted">Loading AP log...</p>}
                        {!apLog.loading && apLog.entries.length === 0 && !apLog.error && (
                            <p className="text-muted">No AP routing entries for this day.</p>
                        )}
                        {!apLog.loading && apLog.entries.map((entry) => (
                            <div
                                key={entry.id}
                                className={`routing-log-entry${entry.status === 'failure' ? ' failure' : ''}`}
                            >
                                <div className="routing-log-entry-top">
                                    <strong>{formatLogTime(entry.createdAt) || 'Unknown time'}</strong>
                                    {entry.status === 'failure' ? (
                                        <span>Failed</span>
                                    ) : (
                                        <div className="routing-log-entry-meta">
                                            <span>{`Code ${entry.codeValue || 'N/A'}`}</span>
                                            <button
                                                type="button"
                                                className="routing-log-edit-icon"
                                                onClick={() => startApInlineEdit(entry)}
                                                disabled={apLog.designationBusyKey === String(entry.jobId || entry.id || '').trim()}
                                                aria-label="Edit AP entry"
                                                title="Edit code, type, vendor, amount, and filenames"
                                            >
                                                <FaEdit />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="routing-log-designation-row">
                                    <span className="routing-log-designation-label">Type:</span>
                                    <strong>{getApRouteKindLabel(entry.routeKind)}</strong>
                                </div>
                                <div className="routing-log-designation-row">
                                    <span className="routing-log-designation-label">Vendor:</span>
                                    <strong>{entry.vendor || 'Vendor not found'}</strong>
                                </div>
                                <div className="routing-log-designation-row">
                                    <span className="routing-log-designation-label">Amount:</span>
                                    <strong>{entry.amount ? formatCurrency(Number(entry.amount)) : 'Not set'}</strong>
                                </div>
                                {apEditingKey === String(entry.jobId || entry.id || '').trim() && (
                                    <div className="routing-log-inline-editor">
                                        <label>
                                            Type
                                            <select
                                                value={apEditDraft.routeKind}
                                                onChange={(event) => setApEditDraft((prev) => ({ ...prev, routeKind: event.target.value }))}
                                            >
                                                {AP_ROUTE_KIND_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label>
                                            Code
                                            <input
                                                type="text"
                                                value={apEditDraft.codeValue}
                                                onChange={(event) => setApEditDraft((prev) => ({ ...prev, codeValue: event.target.value }))}
                                            />
                                        </label>
                                        <label>
                                            Vendor
                                            <input
                                                type="text"
                                                value={apEditDraft.vendor}
                                                onChange={(event) => setApEditDraft((prev) => ({ ...prev, vendor: event.target.value }))}
                                            />
                                        </label>
                                        <label>
                                            Amount
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={apEditDraft.amount}
                                                onChange={(event) => setApEditDraft((prev) => ({ ...prev, amount: event.target.value }))}
                                                onBlur={(event) => setApEditDraft((prev) => ({ ...prev, amount: normalizeAmountInput(event.target.value) }))}
                                                placeholder="Optional"
                                            />
                                        </label>
                                    </div>
                                )}
                                {entry.status === 'failure' && (
                                    <p className="routing-log-error-text">{entry.errorText || 'Unknown routing failure.'}</p>
                                )}
                                {Array.isArray(entry.files) && entry.files.length > 0 ? (
                                    entry.files.map((file) => {
                                        const busyKey = `${entry.id}:${file.fileIndex}`;
                                        const isEditingRow = apEditingKey === String(entry.jobId || entry.id || '').trim();
                                        const isDeleted = isEditingRow && apEditDraft.deleted?.[String(file.fileIndex)] === true;
                                        return (
                                            <div key={`${entry.id}-${file.fileIndex}`} className={`routing-log-file-row${isDeleted ? ' is-deleted' : ''}`}>
                                                {isEditingRow ? (
                                                    <>
                                                        <input
                                                            className="routing-log-filename-input"
                                                            type="text"
                                                            value={String(apEditDraft.files?.[String(file.fileIndex)] ?? file.name ?? '')}
                                                            disabled={isDeleted}
                                                            onChange={(event) => setApEditDraft((prev) => ({
                                                                ...prev,
                                                                files: {
                                                                    ...(prev.files || {}),
                                                                    [String(file.fileIndex)]: event.target.value
                                                                }
                                                            }))}
                                                        />
                                                        <button
                                                            type="button"
                                                            className={`routing-log-delete-button${isDeleted ? ' is-undo' : ''}`}
                                                            onClick={() => setApEditDraft((prev) => ({
                                                                ...prev,
                                                                deleted: {
                                                                    ...(prev.deleted || {}),
                                                                    [String(file.fileIndex)]: !prev.deleted?.[String(file.fileIndex)]
                                                                }
                                                            }))}
                                                        >
                                                            {isDeleted ? 'Undo' : <><FaTrash /> Delete</>}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAttachApFile({ entry, file })}
                                                            disabled={apLog.attachBusyKey === `${String(entry.jobId || entry.id || '').trim()}:${String(file.fileIndex)}`}
                                                        >
                                                            {apLog.attachBusyKey === `${String(entry.jobId || entry.id || '').trim()}:${String(file.fileIndex)}` ? 'Picking...' : 'Pick file'}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span title={file.name}>{file.name}</span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleRevealRoutedFile({
                                                        jobId: entry.id,
                                                        fileIndex: file.fileIndex,
                                                        setState: setApLog,
                                                        type: 'AP',
                                                        logType: 'ap'
                                                    })}
                                                    disabled={apLog.revealBusyKey === busyKey || isDeleted}
                                                >
                                                    {apLog.revealBusyKey === busyKey ? 'Opening...' : 'Reveal file'}
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-muted">No file paths recorded for this entry.</p>
                                )}
                                {apEditingKey === String(entry.jobId || entry.id || '').trim() && (
                                    <div className="routing-log-inline-actions">
                                        <button
                                            type="button"
                                            onClick={() => saveApInlineEdit(entry)}
                                            disabled={apLog.designationBusyKey === String(entry.jobId || entry.id || '').trim()}
                                        >
                                            {apLog.designationBusyKey === String(entry.jobId || entry.id || '').trim() ? 'Saving...' : 'Save'}
                                        </button>
                                        <button type="button" onClick={cancelApInlineEdit}>Cancel</button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {apLog.notice && <div className="alert success">{apLog.notice}</div>}
                        {apLog.error && <div className="alert error">{apLog.error}</div>}
                    </div>
                </Card>

                <Card className="routing-log-card">
                    <div className="routing-log-header">
                        <div>
                            <h2>AR Email Routing</h2>
                            <p>Contribution routing history for the selected day.</p>
                        </div>
                        <div className="routing-log-date-controls">
                            <button
                                type="button"
                                onClick={() => setArDate((prev) => shiftDateKey(prev, -1))}
                            >
                                Previous day
                            </button>
                            <span>{formatLogDate(arDate)}</span>
                            <button
                                type="button"
                                onClick={() => setArDate((prev) => shiftDateKey(prev, 1))}
                                disabled={arDate >= todayKey}
                            >
                                Next day
                            </button>
                        </div>
                    </div>
                    <div className="routing-log-body">
                        {arLog.loading && <p className="text-muted">Loading AR log...</p>}
                        {!arLog.loading && arLog.entries.length === 0 && !arLog.error && (
                            <p className="text-muted">No AR routing entries for this day.</p>
                        )}
                        {!arLog.loading && arLog.entries.map((entry) => (
                            <div
                                key={entry.id}
                                className={`routing-log-entry${entry.status === 'failure' ? ' failure' : ''}`}
                            >
                                <div className="routing-log-entry-top">
                                    <strong>{formatLogTime(entry.createdAt) || 'Unknown time'}</strong>
                                    {entry.status === 'failure' ? (
                                        <span>Failed</span>
                                    ) : (
                                        <div className="routing-log-entry-meta">
                                            {String(entry.envelopeNumber || entry.codeValue || '').trim() ? (
                                                <span className={`routing-env-chip${entry.isPledger ? ' is-pledger' : ''}`}>
                                                    {String(entry.envelopeNumber || entry.codeValue || '').trim()}
                                                </span>
                                            ) : (
                                                <span className="text-muted">No envelope</span>
                                            )}
                                            {String(entry.personName || '').trim() && (
                                                <DataPill
                                                    type="person"
                                                    showType={false}
                                                    value={String(entry.personId || '').trim()}
                                                    label={String(entry.personName || '').trim()}
                                                    tooltip={`Matched person${entry.personMatchConfidence ? ` (${Math.round(Number(entry.personMatchConfidence) * 100)}%)` : ''}`}
                                                />
                                            )}
                                            <button
                                                type="button"
                                                className="routing-log-edit-icon"
                                                onClick={() => startArInlineEdit(entry)}
                                                disabled={arLog.designationBusyKey === String(entry.jobId || entry.id || '').trim()}
                                                aria-label="Edit AR entry"
                                                title="Edit envelope, designation, and filenames"
                                            >
                                                <FaEdit />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="routing-log-designation-row">
                                    <span className="routing-log-designation-label">Designation:</span>
                                    <strong>{entry.designation || 'Unknown designation'}</strong>
                                </div>
                                {arEditingKey === String(entry.jobId || entry.id || '').trim() && (
                                    <div className="routing-log-inline-editor">
                                        <label>
                                            Envelope
                                            <input
                                                type="text"
                                                value={arEditDraft.codeValue}
                                                onChange={(event) => setArEditDraft((prev) => ({ ...prev, codeValue: event.target.value }))}
                                            />
                                        </label>
                                        <label>
                                            Designation
                                            <input
                                                type="text"
                                                value={arEditDraft.designation}
                                                onChange={(event) => setArEditDraft((prev) => ({ ...prev, designation: event.target.value }))}
                                            />
                                        </label>
                                    </div>
                                )}
                                {entry.status === 'failure' && (
                                    <p className="routing-log-error-text">{entry.errorText || 'Unknown routing failure.'}</p>
                                )}
                                {Array.isArray(entry.files) && entry.files.length > 0 ? (
                                    entry.files.map((file) => {
                                        const busyKey = `${entry.id}:${file.fileIndex}`;
                                        const isEditingRow = arEditingKey === String(entry.jobId || entry.id || '').trim();
                                        const isDeleted = isEditingRow && arEditDraft.deleted?.[String(file.fileIndex)] === true;
                                        return (
                                            <div key={`${entry.id}-${file.fileIndex}`} className={`routing-log-file-row${isDeleted ? ' is-deleted' : ''}`}>
                                                {isEditingRow ? (
                                                    <>
                                                        <input
                                                            className="routing-log-filename-input"
                                                            type="text"
                                                            value={String(arEditDraft.files?.[String(file.fileIndex)] ?? file.name ?? '')}
                                                            disabled={isDeleted}
                                                            onChange={(event) => setArEditDraft((prev) => ({
                                                                ...prev,
                                                                files: {
                                                                    ...(prev.files || {}),
                                                                    [String(file.fileIndex)]: event.target.value
                                                                }
                                                            }))}
                                                        />
                                                        <button
                                                            type="button"
                                                            className={`routing-log-delete-button${isDeleted ? ' is-undo' : ''}`}
                                                            onClick={() => setArEditDraft((prev) => ({
                                                                ...prev,
                                                                deleted: {
                                                                    ...(prev.deleted || {}),
                                                                    [String(file.fileIndex)]: !prev.deleted?.[String(file.fileIndex)]
                                                                }
                                                            }))}
                                                        >
                                                            {isDeleted ? 'Undo' : <><FaTrash /> Delete</>}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span title={file.name}>{file.name}</span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleRevealRoutedFile({
                                                        jobId: entry.id,
                                                        fileIndex: file.fileIndex,
                                                        setState: setArLog,
                                                        type: 'AR',
                                                        logType: 'ar'
                                                    })}
                                                    disabled={arLog.revealBusyKey === busyKey || isDeleted}
                                                >
                                                    {arLog.revealBusyKey === busyKey ? 'Opening...' : 'Reveal file'}
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-muted">No file paths recorded for this entry.</p>
                                )}
                                {arEditingKey === String(entry.jobId || entry.id || '').trim() && (
                                    <div className="routing-log-inline-actions">
                                        <button
                                            type="button"
                                            onClick={() => saveArInlineEdit(entry)}
                                            disabled={arLog.designationBusyKey === String(entry.jobId || entry.id || '').trim()}
                                        >
                                            {arLog.designationBusyKey === String(entry.jobId || entry.id || '').trim() ? 'Saving...' : 'Save'}
                                        </button>
                                        <button type="button" onClick={cancelArInlineEdit}>Cancel</button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {arLog.notice && <div className="alert success">{arLog.notice}</div>}
                        {arLog.error && <div className="alert error">{arLog.error}</div>}
                    </div>
                </Card>
            </div>

            <DepositWorkspace />
        </div>
    );
};

export default Finance;
