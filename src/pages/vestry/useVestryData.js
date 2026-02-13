import { useEffect, useMemo, useState } from 'react';
import { addMonths, format, isSameDay, startOfDay } from 'date-fns';

import { API_URL } from '../../services/apiConfig';
import { getVestryDetails, saveVestryDetails } from '../../services/vestryDetails';
import { useEvents } from '../../context/EventsContext';
import {
    BASE_PACKET_DOCS,
    buildDefaultReasons,
    getQuarterLabel,
    getVestryMeetingDate,
    normalizeChecklistPhase
} from './vestryHelpers';

export const useVestryData = () => {
    const { events } = useEvents();
    const [vestryMembers, setVestryMembers] = useState([]);
    const [checklistItems, setChecklistItems] = useState([]);
    const [checklistProgress, setChecklistProgress] = useState(getVestryDetails().checklistProgress || {});
    const [packetItems, setPacketItems] = useState(BASE_PACKET_DOCS.map((doc) => ({ ...doc, file: null })));
    const [packetBusy, setPacketBusy] = useState(false);
    const [packetError, setPacketError] = useState('');
    const [packetUrl, setPacketUrl] = useState('');
    const [packetFilename, setPacketFilename] = useState('Vestry packet.pdf');
    const [packetCache, setPacketCache] = useState({});
    const [packetCacheBusy, setPacketCacheBusy] = useState(false);
    const [packetCacheError, setPacketCacheError] = useState('');
    const [certificateBusy, setCertificateBusy] = useState({ fundA: false, fundB: false, fidelity: false });
    const [certificateError, setCertificateError] = useState('');
    const [previewModal, setPreviewModal] = useState({
        open: false,
        url: '',
        filename: '',
        fundKey: ''
    });
    const [previewError, setPreviewError] = useState('');
    const [previewNotice, setPreviewNotice] = useState('');
    const [previewActionBusy, setPreviewActionBusy] = useState({ save: false, print: false });
    const [workflow, setWorkflow] = useState({
        agendaStatus: 'not_started',
        packetStatus: 'not_started',
        agendaRef: '',
        packetRef: '',
        notes: '',
        updatedAt: null
    });
    const [workflowBusy, setWorkflowBusy] = useState(false);
    const [workflowError, setWorkflowError] = useState('');
    const [certificateAmounts, setCertificateAmounts] = useState(() => {
        const quarterLabel = getQuarterLabel(null);
        const defaults = buildDefaultReasons(quarterLabel);
        return {
            fundA: {
                monthlyAmount: '$1,144.00',
                interestAmount: '',
                ...defaults.fundA
            },
            fundB: {
                monthlyAmount: '',
                interestAmount: '',
                ...defaults.fundB
            },
            fidelity: {
                interestAmount: '',
                ...defaults.fidelity
            }
        };
    });

    useEffect(() => {
        const loadMembers = async () => {
            try {
                const response = await fetch(`${API_URL}/people`);
                if (!response.ok) throw new Error('Failed to load people');
                const data = await response.json();
                const members = (Array.isArray(data) ? data : [])
                    .filter((person) => person.category === 'volunteer')
                    .filter((person) => (person.tags || []).some((tag) => tag.toLowerCase() === 'vestry member'));
                setVestryMembers(members);
            } catch (error) {
                console.error(error);
            }
        };
        loadMembers();
    }, []);

    useEffect(() => {
        const stored = getVestryDetails();
        saveVestryDetails({ ...stored, checklistProgress });
    }, [checklistProgress]);

    useEffect(() => {
        return () => {
            if (packetUrl) URL.revokeObjectURL(packetUrl);
        };
    }, [packetUrl]);

    useEffect(() => {
        const loadPacketCache = async () => {
            try {
                setPacketCacheBusy(true);
                const response = await fetch(`${API_URL}/vestry/packet/cache`);
                if (!response.ok) throw new Error('Failed to load cached files');
                const data = await response.json();
                const items = Array.isArray(data?.items) ? data.items : [];
                const cacheMap = items.reduce((acc, entry) => {
                    if (entry?.id && entry?.cacheId) {
                        acc[entry.id] = {
                            cacheId: entry.cacheId,
                            originalName: entry.originalName || ''
                        };
                    }
                    return acc;
                }, {});
                setPacketCache(cacheMap);
            } catch (error) {
                console.error('Packet cache load error:', error);
                setPacketCacheError('Unable to load cached packet files.');
            } finally {
                setPacketCacheBusy(false);
            }
        };
        loadPacketCache();
    }, []);

    useEffect(() => {
        return () => {
            if (previewModal.url) URL.revokeObjectURL(previewModal.url);
        };
    }, [previewModal.url]);

    const vestryMeetings = useMemo(() => {
        const upcoming = [];
        const today = new Date();
        for (let offset = 0; offset < 8; offset += 1) {
            const date = addMonths(today, offset);
            const meeting = getVestryMeetingDate(date.getFullYear(), date.getMonth());
            if (meeting >= today || upcoming.length === 0) {
                upcoming.push(meeting);
            }
            if (upcoming.length >= 6) break;
        }
        return upcoming;
    }, []);

    const nextMeeting = vestryMeetings[0] || null;
    const [selectedMeeting, setSelectedMeeting] = useState(nextMeeting);
    const today = useMemo(() => startOfDay(new Date()), []);

    useEffect(() => {
        setSelectedMeeting((prev) => prev || nextMeeting);
    }, [nextMeeting]);

    const quarterLabel = useMemo(() => getQuarterLabel(selectedMeeting), [selectedMeeting]);
    const selectedMeetingIso = selectedMeeting ? selectedMeeting.toISOString().slice(0, 10) : '';

    useEffect(() => {
        const defaults = buildDefaultReasons(quarterLabel);
        setCertificateAmounts((prev) => ({
            fundA: {
                ...prev.fundA,
                monthlyReason: prev.fundA.monthlyReason || defaults.fundA.monthlyReason,
                interestReason: prev.fundA.interestReason || defaults.fundA.interestReason
            },
            fundB: {
                ...prev.fundB,
                monthlyReason: prev.fundB.monthlyReason || defaults.fundB.monthlyReason,
                interestReason: prev.fundB.interestReason || defaults.fundB.interestReason
            },
            fidelity: {
                ...prev.fidelity,
                interestReason: prev.fidelity.interestReason || defaults.fidelity.interestReason
            }
        }));
    }, [quarterLabel]);

    useEffect(() => {
        if (!selectedMeetingIso) return;
        const loadWorkflow = async () => {
            try {
                setWorkflowBusy(true);
                setWorkflowError('');
                const response = await fetch(`${API_URL}/vestry/workflow?meetingDate=${encodeURIComponent(selectedMeetingIso)}`);
                if (!response.ok) throw new Error('Failed to load workflow');
                const data = await response.json();
                setWorkflow({
                    agendaStatus: data?.agendaStatus || 'not_started',
                    packetStatus: data?.packetStatus || 'not_started',
                    agendaRef: data?.agendaRef || '',
                    packetRef: data?.packetRef || '',
                    notes: data?.notes || '',
                    updatedAt: data?.updatedAt || null
                });
            } catch (error) {
                console.error('Workflow load error:', error);
                setWorkflowError('Unable to load workflow state.');
            } finally {
                setWorkflowBusy(false);
            }
        };
        loadWorkflow();
    }, [selectedMeetingIso]);

    const otherMeetings = useMemo(() => {
        if (!events.length) return [];
        return events
            .filter((event) => {
                if (!event?.date) return false;
                if (event.date < today) return false;
                const content = `${event.title || ''} ${event.description || ''}`.toLowerCase();
                if (!content.includes('#vestry')) return false;
                if (vestryMeetings.some((meeting) => isSameDay(event.date, meeting))) return false;
                return true;
            })
            .sort((a, b) => {
                const dateCompare = a.date - b.date;
                if (dateCompare !== 0) return dateCompare;
                return (a.time || '').localeCompare(b.time || '');
            });
    }, [events, today, vestryMeetings]);

    const coveredMonthDate = selectedMeeting ? addMonths(selectedMeeting, -1) : null;
    const coveredMonth = coveredMonthDate ? format(coveredMonthDate, 'MMMM') : '';
    const checklistMonth = selectedMeeting ? selectedMeeting.getMonth() + 1 : null;
    const packetFilenameForMeeting = coveredMonthDate
        ? `${format(coveredMonthDate, 'yyyyMM')} Vestry packet.pdf`
        : 'Vestry packet.pdf';
    const meetingDateLabel = selectedMeeting ? format(selectedMeeting, 'MMMM d, yyyy') : 'the upcoming meeting';
    const mailtoBody = [
        'Dear Vestry members, pleased find attached the packet for the vestry meeting on',
        `${meetingDateLabel} at 6:30 in the Library.`,
        '',
        'The zoom link for the meeting is: https://us02web.zoom.us/j/86038156275',
        '',
        'Thank you,'
    ].join('\n');

    useEffect(() => {
        if (!checklistMonth) {
            setChecklistItems([]);
            return;
        }
        const loadChecklist = async () => {
            try {
                const response = await fetch(`${API_URL}/vestry/checklist?month=${checklistMonth}`);
                if (!response.ok) throw new Error('Failed to load checklist');
                const data = await response.json();
                setChecklistItems(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error(error);
                setChecklistItems([]);
            }
        };
        loadChecklist();
    }, [checklistMonth]);

    const packetChecklistDocs = useMemo(() => {
        return checklistItems
            .filter((item) => normalizeChecklistPhase(item.phase) === 'Vestry Package')
            .filter((item) => !item.task.toLowerCase().includes('certificate'))
            .map((item) => ({
                id: `checklist-${item.id}`,
                label: item.task,
                required: false,
                sourceChecklistId: item.id
            }));
    }, [checklistItems]);

    const sortedVestryMembers = useMemo(() => {
        const lastNameKey = (name = '') => {
            const cleaned = String(name || '').trim();
            if (!cleaned) return '';
            const parts = cleaned.split(/\s+/);
            return parts[parts.length - 1].toLowerCase();
        };
        return [...vestryMembers].sort((a, b) => {
            const lastCompare = lastNameKey(a.displayName).localeCompare(lastNameKey(b.displayName));
            if (lastCompare !== 0) return lastCompare;
            return (a.displayName || '').localeCompare(b.displayName || '');
        });
    }, [vestryMembers]);

    useEffect(() => {
        setPacketItems((prev) => {
            const prevById = new Map(prev.map((item) => [item.id, item]));
            const customItems = prev.filter((item) => item.custom);
            const baseItems = BASE_PACKET_DOCS.map((doc) => ({
                ...doc,
                file: prevById.get(doc.id)?.file || null,
                cachedFile: prevById.get(doc.id)?.cachedFile || packetCache[doc.id] || null,
                uploading: prevById.get(doc.id)?.uploading || false
            }));
            const checklistItemsMapped = packetChecklistDocs.map((doc) => ({
                ...doc,
                file: prevById.get(doc.id)?.file || null,
                cachedFile: prevById.get(doc.id)?.cachedFile || packetCache[doc.id] || null,
                uploading: prevById.get(doc.id)?.uploading || false
            }));
            const knownIds = new Set([
                ...baseItems.map((item) => item.id),
                ...checklistItemsMapped.map((item) => item.id),
                ...customItems.map((item) => item.id)
            ]);
            const cachedCustomItems = Object.keys(packetCache || {})
                .filter((id) => !knownIds.has(id))
                .map((id) => ({
                    id,
                    label: packetCache[id]?.originalName || 'Additional Document',
                    required: false,
                    file: null,
                    cachedFile: packetCache[id] || null,
                    custom: true
                }));
            return [...baseItems, ...checklistItemsMapped, ...customItems, ...cachedCustomItems];
        });
    }, [packetChecklistDocs, packetCache]);

    const checklistGroups = useMemo(() => {
        const phases = ['Pre-Vestry', 'Vestry Package', 'Post-Vestry'];
        const grouped = phases.map((phase) => ({
            phase,
            items: checklistItems.filter((item) => {
                const normalized = normalizeChecklistPhase(item.phase);
                if (phase !== 'Vestry Package') return normalized === phase;
                return normalized === phase && !item.task.toLowerCase().includes('certificate');
            })
        }));
        const other = checklistItems.filter((item) => !phases.includes(normalizeChecklistPhase(item.phase)));
        if (other.length) grouped.push({ phase: 'Other', items: other });
        const visibleGroups = grouped.filter((group) => group.items.length > 0);
        if (visibleGroups.length || checklistItems.length === 0) {
            return visibleGroups;
        }
        const fallback = phases.map((phase) => ({
            phase,
            items: checklistItems.filter((item) => normalizeChecklistPhase(item.phase) === phase)
        }));
        const fallbackOther = checklistItems.filter((item) => !phases.includes(normalizeChecklistPhase(item.phase)));
        if (fallbackOther.length) fallback.push({ phase: 'Other', items: fallbackOther });
        return fallback.filter((group) => group.items.length > 0);
    }, [checklistItems]);

    const certificateItems = useMemo(() => {
        return checklistItems.filter((item) => {
            const normalized = normalizeChecklistPhase(item.phase);
            return normalized === 'Vestry Package' && item.task.toLowerCase().includes('certificate');
        });
    }, [checklistItems]);

    const certificateGroups = useMemo(() => {
        const monthly = certificateItems.filter((item) => {
            const task = item.task.toLowerCase();
            return task.includes('shared') || task.includes('expense');
        });
        const quarterly = certificateItems.filter((item) => {
            const task = item.task.toLowerCase();
            return task.includes('interest') || task.includes('fidelity') || task.includes('quarter');
        });
        return { monthly, quarterly };
    }, [certificateItems]);

    const updateCertificateAmount = (groupKey, fieldKey, value) => {
        setCertificateAmounts((prev) => ({
            ...prev,
            [groupKey]: {
                ...prev[groupKey],
                [fieldKey]: value
            }
        }));
    };

    const buildCertificatePayload = (fundKey) => ({
        fund: fundKey,
        meetingDate: selectedMeeting.toISOString(),
        quarterly: certificateGroups.quarterly.length > 0,
        amounts: {
            monthly: fundKey !== 'fidelity' ? certificateAmounts[fundKey].monthlyAmount || '' : '',
            interest: certificateAmounts[fundKey].interestAmount || ''
        }
    });

    const closePreviewModal = () => {
        if (previewModal.url) URL.revokeObjectURL(previewModal.url);
        setPreviewModal({ open: false, url: '', filename: '', fundKey: '' });
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy({ save: false, print: false });
    };

    const generateCertificatePreview = async (fundKey) => {
        if (!selectedMeeting) return;
        setCertificateError('');
        setPreviewError('');
        setPreviewNotice('');
        setCertificateBusy((prev) => ({ ...prev, [fundKey]: true }));
        try {
            const payload = buildCertificatePayload(fundKey);
            const response = await fetch(`${API_URL}/vestry/certificate/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                let message = 'Unable to generate the certificate.';
                try {
                    const data = await response.json();
                    if (data?.error) message = data.error;
                } catch {
                    // Use fallback message.
                }
                throw new Error(message);
            }
            const data = await response.json();
            const pngBase64 = data?.pngBase64 || '';
            if (!pngBase64) {
                throw new Error('Preview data missing.');
            }
            const byteCharacters = atob(pngBase64);
            const byteNumbers = Array.from(byteCharacters).map((char) => char.charCodeAt(0));
            const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            setPreviewModal({
                open: true,
                url,
                filename: data?.filename || 'certificate.docx',
                fundKey
            });
        } catch (error) {
            console.error('Certificate generation error:', error);
            setCertificateError(error?.message || 'Unable to generate the certificate.');
        } finally {
            setCertificateBusy((prev) => ({ ...prev, [fundKey]: false }));
        }
    };

    const saveCertificate = async () => {
        if (!previewModal.fundKey || !selectedMeeting) return;
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy((prev) => ({ ...prev, save: true }));
        try {
            const payload = buildCertificatePayload(previewModal.fundKey);
            const response = await fetch(`${API_URL}/vestry/certificate/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                let message = 'Unable to save the certificate.';
                try {
                    const data = await response.json();
                    if (data?.error) message = data.error;
                } catch {
                    // Use fallback message.
                }
                throw new Error(message);
            }
            const data = await response.json();
            setPreviewNotice(`Saved ${data?.filename || 'certificate'}.`);
        } catch (error) {
            console.error('Certificate save error:', error);
            setPreviewError(error?.message || 'Unable to save the certificate.');
        } finally {
            setPreviewActionBusy((prev) => ({ ...prev, save: false }));
        }
    };

    const printCertificate = async () => {
        if (!previewModal.fundKey || !selectedMeeting) return;
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy((prev) => ({ ...prev, print: true }));
        try {
            const payload = buildCertificatePayload(previewModal.fundKey);
            const response = await fetch(`${API_URL}/vestry/certificate/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                let message = 'Unable to print the certificate.';
                try {
                    const data = await response.json();
                    if (data?.error) message = data.error;
                } catch {
                    // Use fallback message.
                }
                throw new Error(message);
            }
            setPreviewNotice('Sent to printer.');
        } catch (error) {
            console.error('Certificate print error:', error);
            setPreviewError(error?.message || 'Unable to print the certificate.');
        } finally {
            setPreviewActionBusy((prev) => ({ ...prev, print: false }));
        }
    };

    const updatePacketItem = (id, updates) => {
        setPacketItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
    };

    const reorderPacketItems = (activeId, targetId) => {
        if (!activeId || !targetId || activeId === targetId) return;
        setPacketItems((prev) => {
            const activeIndex = prev.findIndex((item) => item.id === activeId);
            const targetIndex = prev.findIndex((item) => item.id === targetId);
            if (activeIndex === -1 || targetIndex === -1) return prev;
            const copy = [...prev];
            const [item] = copy.splice(activeIndex, 1);
            copy.splice(targetIndex, 0, item);
            return copy;
        });
    };

    const addCustomDoc = () => {
        setPacketItems((prev) => ([
            ...prev,
            { id: `custom-${Date.now()}`, label: 'Additional Document', required: false, file: null, cachedFile: null, custom: true }
        ]));
    };

    const removeCustomDoc = (id) => {
        setPacketItems((prev) => prev.filter((item) => item.id !== id));
    };

    const hasPacketFile = (item) => !!(item.file || item.cachedFile);

    const handlePacketFileUpload = async (itemId, file) => {
        if (!file) return;
        setPacketError('');
        setPacketCacheError('');
        updatePacketItem(itemId, { uploading: true });
        try {
            const formData = new FormData();
            formData.append('itemId', itemId);
            formData.append('file', file);
            const response = await fetch(`${API_URL}/vestry/packet/cache`, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                throw new Error('Failed to cache packet file');
            }
            const data = await response.json();
            const cachedFile = {
                cacheId: data?.cacheId || '',
                originalName: data?.originalName || file.name
            };
            setPacketCache((prev) => ({ ...prev, [itemId]: cachedFile }));
            updatePacketItem(itemId, {
                file: null,
                cachedFile,
                uploading: false
            });
        } catch (error) {
            console.error('Packet cache upload error:', error);
            setPacketCacheError('Unable to cache the uploaded file.');
            updatePacketItem(itemId, { uploading: false });
        }
    };

    const clearPacketCache = async () => {
        setPacketCacheError('');
        setPacketCacheBusy(true);
        try {
            const response = await fetch(`${API_URL}/vestry/packet/cache`, {
                method: 'DELETE'
            });
            if (!response.ok) {
                throw new Error('Failed to clear cache');
            }
            setPacketCache({});
            setPacketItems((prev) => prev.map((item) => ({
                ...item,
                cachedFile: null
            })));
        } catch (error) {
            console.error('Packet cache clear error:', error);
            setPacketCacheError('Unable to clear cached packet files.');
        } finally {
            setPacketCacheBusy(false);
        }
    };

    const buildPacket = async () => {
        setPacketError('');
        setPacketBusy(true);
        try {
            const missing = packetItems.filter((item) => item.required && !hasPacketFile(item));
            if (missing.length > 0) {
                setPacketError('Upload all required documents before building the packet.');
                setPacketBusy(false);
                return;
            }

            const formData = new FormData();
            packetItems.forEach((item) => {
                if (item.file) {
                    formData.append(item.id, item.file);
                }
            });
            formData.append('order', JSON.stringify(packetItems.map(({ id, label, required }) => ({ id, label, required }))));
            formData.append(
                'cached',
                JSON.stringify(
                    packetItems
                        .filter((item) => item.cachedFile?.cacheId)
                        .map((item) => ({ id: item.id, cacheId: item.cachedFile.cacheId }))
                )
            );

            const response = await fetch(`${API_URL}/vestry/packet`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Packet build failed');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setPacketUrl(url);
            setPacketFilename(packetFilenameForMeeting);
            await saveWorkflow({
                ...workflow,
                packetStatus: 'ready',
                packetRef: packetFilenameForMeeting
            });
        } catch (error) {
            console.error(error);
            setPacketError('Unable to build the vestry packet.');
        } finally {
            setPacketBusy(false);
        }
    };

    const updateWorkflowField = (key, value) => {
        setWorkflow((prev) => ({ ...prev, [key]: value }));
    };

    const saveWorkflow = async (updates = null) => {
        if (!selectedMeetingIso) return null;
        const nextWorkflow = {
            ...workflow,
            ...(updates || {})
        };
        try {
            setWorkflowBusy(true);
            setWorkflowError('');
            const response = await fetch(`${API_URL}/vestry/workflow`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    meetingDate: selectedMeetingIso,
                    agendaStatus: nextWorkflow.agendaStatus,
                    packetStatus: nextWorkflow.packetStatus,
                    agendaRef: nextWorkflow.agendaRef,
                    packetRef: nextWorkflow.packetRef,
                    notes: nextWorkflow.notes
                })
            });
            if (!response.ok) throw new Error('Failed to save workflow');
            const data = await response.json();
            setWorkflow({
                agendaStatus: data?.agendaStatus || 'not_started',
                packetStatus: data?.packetStatus || 'not_started',
                agendaRef: data?.agendaRef || '',
                packetRef: data?.packetRef || '',
                notes: data?.notes || '',
                updatedAt: data?.updatedAt || null
            });
            return data;
        } catch (error) {
            console.error('Workflow save error:', error);
            setWorkflowError('Unable to save workflow state.');
            return null;
        } finally {
            setWorkflowBusy(false);
        }
    };

    const completedCount = checklistItems.filter((item) => checklistProgress[item.id]).length;
    const requiredDocs = packetItems.filter((item) => item.required);
    const requiredUploaded = requiredDocs.filter((item) => hasPacketFile(item)).length;
    const optionalUploaded = packetItems.filter((item) => !item.required && hasPacketFile(item)).length;
    const hasQuarterlyInterest = certificateGroups.quarterly.length > 0;

    return {
        vestryMembers,
        sortedVestryMembers,
        checklistItems,
        checklistGroups,
        checklistProgress,
        packetItems,
        packetBusy,
        packetError,
        packetUrl,
        packetFilename,
        packetCacheBusy,
        packetCacheError,
        packetCache,
        certificateBusy,
        certificateError,
        certificateAmounts,
        previewModal,
        previewError,
        previewNotice,
        previewActionBusy,
        workflow,
        workflowBusy,
        workflowError,
        vestryMeetings,
        nextMeeting,
        selectedMeeting,
        otherMeetings,
        coveredMonth,
        mailtoBody,
        requiredDocs,
        requiredUploaded,
        optionalUploaded,
        completedCount,
        hasQuarterlyInterest,
        certificateItems,
        certificateGroups,
        setChecklistProgress,
        setSelectedMeeting,
        updateCertificateAmount,
        generateCertificatePreview,
        closePreviewModal,
        saveCertificate,
        printCertificate,
        updatePacketItem,
        reorderPacketItems,
        addCustomDoc,
        removeCustomDoc,
        handlePacketFileUpload,
        clearPacketCache,
        buildPacket,
        hasPacketFile,
        updateWorkflowField,
        saveWorkflow
    };
};
