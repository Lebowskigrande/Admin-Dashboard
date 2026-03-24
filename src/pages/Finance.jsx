import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaEdit, FaEye, FaPrint, FaSave, FaTrash } from 'react-icons/fa';
import Card from '../components/Card';
import DataPill from '../components/DataPill';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import { formatCurrency } from '../utils/formatters';
import './Finance.css';

const MIN_DEPOSIT_ROWS = 18;

const createCheckRow = () => ({
    id: globalThis.crypto?.randomUUID?.() || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    checkNumber: '',
    amount: '',
    budget: ''
});

const createChecks = (count = MIN_DEPOSIT_ROWS) => Array.from({ length: count }, () => createCheckRow());

const DEPOSIT_STORAGE_KEY = 'deposit-slip-checks';
const ROUTING_LOG_REFRESH_MS = 30 * 1000;

const normalizeStorageAmount = (value) => {
    if (value == null) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return '';
    return numeric.toFixed(2);
};



const formatDateStamp = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
};

const buildDepositFilename = (total) => {
    const numeric = Number(total);
    const amount = Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
    return `${formatDateStamp()} Deposit $${amount}.pdf`;
};

const normalizeAmountInput = (value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return '';
    return numeric.toFixed(2);
};

const buildPayloadAmount = (value) => {
    const normalized = normalizeAmountInput(value);
    if (!normalized) return '';
    return `$${normalized}`;
};

const loadSavedChecks = () => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(DEPOSIT_STORAGE_KEY);
    if (!stored) return null;
    try {
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const normalizeSavedCheck = (savedEntry) => ({
    ...createCheckRow(),
    checkNumber: savedEntry?.checkNumber != null ? String(savedEntry.checkNumber) : '',
    amount: normalizeStorageAmount(savedEntry?.amount) || '',
    budget: savedEntry?.budget != null ? String(savedEntry.budget) : ''
});

const buildInitialChecks = () => {
    const saved = loadSavedChecks();
    if (!Array.isArray(saved) || saved.length === 0) {
        return createChecks();
    }
    const normalized = saved.map((entry) => normalizeSavedCheck(entry));
    const targetLength = Math.max(MIN_DEPOSIT_ROWS, normalized.length);
    return [
        ...normalized,
        ...createChecks(Math.max(0, targetLength - normalized.length))
    ];
};

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
    const [checks, setChecks] = useState(() => buildInitialChecks());
    const [slipBusy, setSlipBusy] = useState(false);
    const [slipError, setSlipError] = useState('');
    const [saveMessage, setSaveMessage] = useState('');
    const [previewModal, setPreviewModal] = useState({
        open: false,
        url: '',
        fileId: ''
    });
    const [previewNotice, setPreviewNotice] = useState('');
    const [previewError, setPreviewError] = useState('');
    const [previewActionBusy, setPreviewActionBusy] = useState({ save: false, print: false });
    const [depositSlipFileId, setDepositSlipFileId] = useState('');
    const saveMessageTimeoutRef = useRef(null);
    const [checksPdfFile, setChecksPdfFile] = useState(null);
    const [cashPdfFile, setCashPdfFile] = useState(null);
    const [uploadResetKey, setUploadResetKey] = useState(0);
    const [apDate, setApDate] = useState(() => formatDateKey(new Date()));
    const [arDate, setArDate] = useState(() => formatDateKey(new Date()));
    const [apLog, setApLog] = useState({ loading: false, error: '', notice: '', entries: [], revealBusyKey: '', designationBusyKey: '', attachBusyKey: '' });
    const [arLog, setArLog] = useState({ loading: false, error: '', notice: '', entries: [], revealBusyKey: '', designationBusyKey: '' });
    const [apEditingKey, setApEditingKey] = useState('');
    const [apEditDraft, setApEditDraft] = useState({ codeValue: '', vendor: '', files: {}, filePaths: {}, deleted: {} });
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

    const updateCheck = (index, field, value) => {
        setChecks((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
        if (depositSlipFileId) {
            setDepositSlipFileId('');
        }
    };

    const addCheckRow = () => {
        setChecks((prev) => [...prev, createCheckRow()]);
        if (depositSlipFileId) {
            setDepositSlipFileId('');
        }
    };

    const removeCheckRow = (index) => {
        setChecks((prev) => {
            if (prev.length <= MIN_DEPOSIT_ROWS || index < MIN_DEPOSIT_ROWS) return prev;
            return prev.filter((_, rowIndex) => rowIndex !== index);
        });
        if (depositSlipFileId) {
            setDepositSlipFileId('');
        }
    };

    const handleSaveDepositData = () => {
        if (typeof window === 'undefined') {
            setSaveMessage('Unable to save deposit data.');
            return;
        }
        try {
            window.localStorage.setItem(DEPOSIT_STORAGE_KEY, JSON.stringify(checks));
            setSaveMessage('Deposit data saved locally.');
        } catch (error) {
            console.error('Failed to save deposit data:', error);
            setSaveMessage('Unable to save deposit data.');
        } finally {
            if (saveMessageTimeoutRef.current) {
                clearTimeout(saveMessageTimeoutRef.current);
            }
            saveMessageTimeoutRef.current = window.setTimeout(() => {
                setSaveMessage('');
                saveMessageTimeoutRef.current = null;
            }, 4000);
        }
    };

    const handleBuildDepositPacket = async () => {
        if (!checksPdfFile) {
            setSlipError('Upload the checks PDF.');
            return;
        }
        setSlipError('');
        setPreviewError('');
        setPreviewNotice('');
        setSlipBusy(true);
        try {
            let slipFileId = depositSlipFileId;
            if (!slipFileId) {
                slipFileId = await requestDepositSlipFile();
                setDepositSlipFileId(slipFileId);
            }
            const formData = new FormData();
            formData.append('checksPdf', checksPdfFile);
            formData.append('cashPdf', cashPdfFile);
            formData.append('slipFileId', slipFileId);
            const payloadChecks = checks.map((entry) => ({
                checkNumber: entry.checkNumber || '',
                amount: buildPayloadAmount(entry.amount)
            }));
            formData.append('checks', JSON.stringify(payloadChecks));
            formData.append('totals', JSON.stringify({
                cash: cashTotal,
                subtotal: overallTotal,
                total: overallTotal
            }));
            formData.append('fundsReport', JSON.stringify({
                entries: fundsReportEntries
            }));
            const response = await fetch(`${API_URL}/deposit-slip/pdf`, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) throw new Error('Failed to build deposit packet');
            const data = await response.json();
            if (!data?.fileId) throw new Error('Missing PDF data');
            setPreviewModal({
                open: true,
                url: buildPreviewUrl(data.fileId),
                fileId: data.fileId
            });
        } catch (error) {
            console.error('Deposit packet error:', error);
            setSlipError('Unable to build the deposit packet with the uploaded PDFs.');
        } finally {
            setSlipBusy(false);
        }
    };

    useEffect(() => () => {
        if (saveMessageTimeoutRef.current) {
            clearTimeout(saveMessageTimeoutRef.current);
        }
    }, []);

    const budgetTotals = useMemo(() => {
        return checks.reduce((acc, check) => {
            const budget = String(check.budget || '').trim();
            const amount = Number(check.amount);
            if (!budget || Number.isNaN(amount)) return acc;
            acc[budget] = (acc[budget] || 0) + amount;
            return acc;
        }, {});
    }, [checks]);

    const fundsReportEntries = useMemo(() => {
        return Object.entries(budgetTotals)
            .map(([code, total]) => ({ code, amount: total }))
            .sort((a, b) => a.code.localeCompare(b.code));
    }, [budgetTotals]);

    const cashTotal = useMemo(() => {
        return checks.reduce((sum, check) => {
            const hasCheck = String(check.checkNumber || '').trim();
            const amount = Number(check.amount);
            if (Number.isNaN(amount) || amount <= 0) return sum;
            if (hasCheck) return sum;
            return sum + amount;
        }, 0);
    }, [checks]);

    const overallTotal = useMemo(() => {
        return checks.reduce((sum, check) => {
            const amount = Number(check.amount);
            if (Number.isNaN(amount)) return sum;
            return sum + amount;
        }, 0);
    }, [checks]);

    const buildPreviewUrl = (fileId) => `${API_URL}/deposit-slip/file/${fileId}`;

    const requestDepositSlipFile = async () => {
        const payloadChecks = checks.map((entry) => ({
            checkNumber: entry.checkNumber || '',
            amount: buildPayloadAmount(entry.amount)
        }));
        const response = await fetch(`${API_URL}/deposit-slip/manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                checks: payloadChecks,
                totals: {
                    cash: cashTotal,
                    subtotal: overallTotal,
                    total: overallTotal
                },
                fundsReport: {
                    entries: fundsReportEntries
                }
            })
        });
        if (!response.ok) throw new Error('Failed to build deposit slip');
        const data = await response.json();
        if (!data?.fileId) throw new Error('Missing PDF file');
        return data.fileId;
    };

    const handleGenerateDepositSlip = async () => {
        setSlipError('');
        setPreviewError('');
        setPreviewNotice('');
        setSlipBusy(true);
        try {
            const fileId = depositSlipFileId || await requestDepositSlipFile();
            if (!depositSlipFileId) {
                setDepositSlipFileId(fileId);
            }
            setPreviewModal({
                open: true,
                url: buildPreviewUrl(fileId),
                fileId
            });
        } catch (error) {
            console.error('Deposit slip error:', error);
            setSlipError('Unable to generate deposit slip with the provided entries.');
        } finally {
            setSlipBusy(false);
        }
    };

    const closePreviewModal = () => {
        setPreviewModal({ open: false, url: '', fileId: '' });
        setPreviewNotice('');
        setPreviewError('');
        setPreviewActionBusy({ save: false, print: false });
    };

    const handleSaveSlip = async () => {
        if (!previewModal.fileId) return;
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy((prev) => ({ ...prev, save: true }));
        const filename = buildDepositFilename(overallTotal);
        try {
            const response = await fetch(buildPreviewUrl(previewModal.fileId));
            if (!response.ok) throw new Error('Unable to load deposit slip.');
            const blob = await response.blob();
            if (window?.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [
                        {
                            description: 'PDF',
                            accept: { 'application/pdf': ['.pdf'] }
                        }
                    ]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                setPreviewNotice('Deposit slip saved.');
                return;
            }
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
            setPreviewNotice('Deposit slip saved.');
        } catch (error) {
            console.error('Deposit slip save error:', error);
            setPreviewError('Unable to save the deposit slip.');
        } finally {
            setPreviewActionBusy((prev) => ({ ...prev, save: false }));
        }
    };

    const handlePrintSlip = async () => {
        if (!previewModal.fileId) return;
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy((prev) => ({ ...prev, print: true }));
        try {
            const response = await fetch(`${API_URL}/deposit-slip/print-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: previewModal.fileId })
            });
            if (!response.ok) {
                throw new Error('Unable to print the deposit slip.');
            }
            setPreviewNotice('Sent to printer.');
        } catch (error) {
            console.error('Deposit slip print error:', error);
            setPreviewError(error?.message || 'Unable to print the deposit slip.');
        } finally {
            setPreviewActionBusy((prev) => ({ ...prev, print: false }));
        }
    };

    const handleClearDepositForm = async () => {
        setChecks(createChecks());
        setChecksPdfFile(null);
        setCashPdfFile(null);
        setUploadResetKey((value) => value + 1);
        setSlipError('');
        setPreviewError('');
        setPreviewNotice('');
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.removeItem(DEPOSIT_STORAGE_KEY);
            } catch {
                // ignore
            }
        }
        const idsToDelete = new Set([depositSlipFileId, previewModal.fileId].filter(Boolean));
        if (idsToDelete.size > 0) {
            await Promise.all(
                Array.from(idsToDelete).map((fileId) => (
                    fetch(`${API_URL}/deposit-slip/file/${fileId}`, { method: 'DELETE' }).catch(() => { })
                ))
            );
        }
        setDepositSlipFileId('');
        setPreviewModal({ open: false, url: '', fileId: '' });
    };

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
        setApEditDraft({ codeValue: '', vendor: '', files: {}, filePaths: {}, deleted: {} });
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
                    <p className="page-header-subtitle is-empty" aria-hidden="true">Spacer</p>
                </div>
            </header>

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
                                                title="Edit code, vendor, and filenames"
                                            >
                                                <FaEdit />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="routing-log-designation-row">
                                    <span className="routing-log-designation-label">Vendor:</span>
                                    <strong>{entry.vendor || 'Vendor not found'}</strong>
                                </div>
                                {apEditingKey === String(entry.jobId || entry.id || '').trim() && (
                                    <div className="routing-log-inline-editor">
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

            <Card className="deposit-card manual-deposit">
                <div className="deposit-header">
                    <div>
                        <h2>Deposit Slip Builder</h2>
                        <p>Enter as many check or cash rows as needed. Deposit slips use 18 checks per page.</p>
                    </div>
                    <div className="deposit-header-actions">
                        <button
                            type="button"
                            className="deposit-clear-button"
                            onClick={handleClearDepositForm}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="deposit-save-button"
                            onClick={handleSaveDepositData}
                        >
                            Save deposit data
                        </button>
                        <button
                            type="button"
                            className="deposit-download-button"
                            onClick={handleGenerateDepositSlip}
                            disabled={slipBusy || overallTotal <= 0}
                            aria-label="Preview deposit slip"
                        >
                            <FaEye />
                        </button>
                    </div>
                </div>
                <div className="deposit-builder-body">
                    <div className="deposit-checks-panel">
                        <div className="deposit-table-toolbar">
                            <p>{checks.length} row{checks.length === 1 ? '' : 's'} entered</p>
                            <button type="button" className="deposit-add-row-button" onClick={addCheckRow}>
                                Add row
                            </button>
                        </div>
                        <div className="deposit-checks-table-wrapper">
                        <table className="deposit-checks-table">
                            <thead>
                                <tr>
                                    <th>Check #</th>
                                    <th>Amount</th>
                                    <th>Budget Code</th>
                                    <th aria-label="Row actions" />
                                </tr>
                            </thead>
                            <tbody>
                                {checks.map((check, index) => (
                                    <tr key={check.id}>
                                        <td>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min="0"
                                                step="1"
                                                pattern="[0-9]*"
                                                value={check.checkNumber}
                                                onChange={(event) => updateCheck(index, 'checkNumber', event.target.value)}
                                                placeholder="e.g. 1034"
                                            />
                                        </td>
                                        <td>
                                            <div className="amount-input">
                                                <span>$</span>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0"
                                                    step="0.01"
                                                    value={check.amount}
                                                    onChange={(event) => updateCheck(index, 'amount', event.target.value)}
                                                    onBlur={(event) => updateCheck(index, 'amount', normalizeAmountInput(event.target.value))}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </td>
                                        <td>
                                            <input
                                                type="text"
                                                pattern="[A-Za-z0-9]*"
                                                value={check.budget}
                                                onChange={(event) => updateCheck(index, 'budget', event.target.value)}
                                                placeholder="Budget code"
                                            />
                                        </td>
                                        <td className="deposit-row-actions">
                                            {index >= MIN_DEPOSIT_ROWS ? (
                                                <button
                                                    type="button"
                                                    className="deposit-row-remove-button"
                                                    onClick={() => removeCheckRow(index)}
                                                    aria-label={`Remove row ${index + 1}`}
                                                >
                                                    Remove
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    </div>
                    <div className="deposit-side-panel">
                        <div className="deposit-total-panel">
                            <h3>Totals by Budget Code</h3>
                            <div className="deposit-total-list">
                                {Object.keys(budgetTotals).length === 0 ? (
                                    <p className="empty-state">Enter budget codes to see totals.</p>
                                ) : (
                                    Object.entries(budgetTotals).map(([code, total]) => (
                                        <div key={code} className="deposit-total-line">
                                            <span>{code}</span>
                                            <strong>{formatCurrency(total)}</strong>
                                        </div>
                                    ))
                                )}
                            </div>
                            <div className="deposit-total-line cash">
                                <span>Cash (no check #)</span>
                                <strong>{formatCurrency(cashTotal)}</strong>
                            </div>
                            <div className="deposit-total-divider" />
                            <div className="deposit-total-line overall">
                                <span>Total</span>
                                <strong>{formatCurrency(overallTotal)}</strong>
                            </div>
                            <div className="deposit-status-area">
                                {saveMessage && <p className="deposit-save-message">{saveMessage}</p>}
                                {slipError && <div className="alert error">{slipError}</div>}
                            </div>
                        </div>
                        <div className="deposit-upload-panel">
                            <h3>Deposit Attachments</h3>
                            <div className="deposit-upload-field">
                                <label htmlFor="deposit-checks-pdf">Checks PDF</label>
                                <input
                                    key={`checks-${uploadResetKey}`}
                                    id="deposit-checks-pdf"
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(event) => setChecksPdfFile(event.target.files?.[0] || null)}
                                />
                                <p className="deposit-upload-hint">
                                    {checksPdfFile ? checksPdfFile.name : 'Upload the scanned checks PDF.'}
                                </p>
                            </div>
                            <div className="deposit-upload-field">
                                <label htmlFor="deposit-cash-pdf">Cash Count PDF</label>
                                <input
                                    key={`cash-${uploadResetKey}`}
                                    id="deposit-cash-pdf"
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(event) => setCashPdfFile(event.target.files?.[0] || null)}
                                />
                                <p className="deposit-upload-hint">
                                    {cashPdfFile ? cashPdfFile.name : 'Optional. Upload the cash count PDF if available.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="deposit-build-button deposit-build-secondary"
                                onClick={handleBuildDepositPacket}
                                disabled={slipBusy || overallTotal <= 0 || !checksPdfFile}
                            >
                                Build deposit
                            </button>
                        </div>
                    </div>
                </div>
            </Card>

            <Modal isOpen={previewModal.open} onClose={closePreviewModal} title="Deposit Slip Preview" className="modal-large deposit-preview-modal">
                <div className="deposit-preview">
                    <div className="deposit-preview-toolbar">
                        <div className="deposit-preview-actions">
                            <button
                                className="btn-icon"
                                type="button"
                                aria-label="Save deposit slip"
                                disabled={!previewModal.fileId || previewActionBusy.save}
                                onClick={handleSaveSlip}
                            >
                                <FaSave />
                            </button>
                            <button
                                className="btn-icon"
                                type="button"
                                aria-label="Print deposit slip"
                                disabled={!previewModal.fileId || previewActionBusy.print}
                                onClick={handlePrintSlip}
                            >
                                <FaPrint />
                            </button>
                        </div>
                    </div>
                    {previewError && <div className="alert error">{previewError}</div>}
                    {previewNotice && <div className="alert success">{previewNotice}</div>}
                    <div className="deposit-preview-frame">
                        {previewModal.url ? (
                            <div className="deposit-preview-page">
                                <iframe
                                    src={`${previewModal.url}#view=FitV&toolbar=0&navpanes=0`}
                                    title="Deposit slip preview"
                                />
                            </div>
                        ) : (
                            <span className="text-muted">No preview available.</span>
                        )}
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Finance;
