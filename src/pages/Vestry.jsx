import { useEffect, useMemo, useState } from 'react';
import { FaDownload, FaPaperPlane, FaPlus, FaTrash } from 'react-icons/fa';
import { addMonths, format, isSameDay, startOfDay } from 'date-fns';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { ROLE_DEFINITIONS } from '../models/roles';
import { getVestryDetails, saveVestryDetails } from '../services/vestryDetails';
import { useEvents } from '../context/EventsContext';
import './Vestry.css';
import '../styles/people-shared.css';
import './People.css';

const BASE_PACKET_DOCS = [
    { id: 'agenda', label: 'Agenda', required: true },
    { id: 'minutes', label: 'Previous Minutes', required: true },
    { id: 'treasurer', label: 'Treasurer Report', required: true },
    { id: 'church-financials', label: 'Church Financials (P&L, BS, Ledger, Pledges)', required: true },
    { id: 'school-pl', label: 'School P&L', required: true },
    { id: 'school-bs', label: 'School Balance Sheet', required: true }
];

const getNthThursday = (year, month, nth) => {
    const first = new Date(year, month, 1);
    const day = first.getDay();
    const offset = (4 - day + 7) % 7;
    const date = 1 + offset + (nth - 1) * 7;
    return new Date(year, month, date);
};

const getVestryMeetingDate = (year, month) => {
    const nth = (month === 10 || month === 11) ? 3 : 4;
    return getNthThursday(year, month, nth);
};

const Vestry = () => {
    const { events } = useEvents();
    const [vestryMembers, setVestryMembers] = useState([]);
    const [checklistItems, setChecklistItems] = useState([]);
    const [checklistProgress, setChecklistProgress] = useState(getVestryDetails().checklistProgress || {});
    const [packetItems, setPacketItems] = useState(BASE_PACKET_DOCS.map((doc) => ({ ...doc, file: null })));
    const [packetBusy, setPacketBusy] = useState(false);
    const [packetError, setPacketError] = useState('');
    const [packetUrl, setPacketUrl] = useState('');
    const [packetFilename, setPacketFilename] = useState('Vestry packet.pdf');
    const [draggedId, setDraggedId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);
    const [openTooltipKey, setOpenTooltipKey] = useState(null);
    const getQuarterLabel = (meetingDate) => {
        const baseDate = meetingDate || new Date();
        const previousMonth = (baseDate.getMonth() + 11) % 12;
        const quarterIndex = Math.floor(previousMonth / 3);
        return ['Q1', 'Q2', 'Q3', 'Q4'][quarterIndex] || 'Q1';
    };

    const buildDefaultReasons = (quarterLabel) => ({
        monthly: {
            fundAReason: "20% of Associate Rector's salary",
            fundBReason: '50% of shared expenses'
        },
        quarterly: {
            fundAReason: `Interest earned by Fund A in ${quarterLabel}`,
            fundBReason: `Interest earned by Fund B in ${quarterLabel}`,
            fidelityReason: `Interest earned by Fidelity in ${quarterLabel}`
        }
    });

    const [certificateAmounts, setCertificateAmounts] = useState(() => {
        const quarterLabel = getQuarterLabel(null);
        const defaults = buildDefaultReasons(quarterLabel);
        return {
            monthly: { fundA: '', fundB: '', ...defaults.monthly },
            quarterly: { fundA: '', fundB: '', fidelity: '', ...defaults.quarterly }
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
        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-tooltip') || target.closest('.person-chip-wrapper')) return;
            setOpenTooltipKey(null);
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, []);

    const roleLabel = (key) => ROLE_DEFINITIONS.find((role) => role.key === key)?.label || key;

    const renderTooltipCard = (person) => {
        if (!person) return null;
        const tags = person.tags || [];
        const extensionTag = tags.find((tag) => tag.startsWith('ext-'));
        const phoneTag = tags.find((tag) => /^phone[:\-]/i.test(tag)) || tags.find((tag) => /^tel[:\-]/i.test(tag));
        const rawPhone = phoneTag ? phoneTag.replace(/^phone[:\-]\s*/i, '').replace(/^tel[:\-]\s*/i, '').trim() : '';
        const barePhoneTag = tags.find((tag) => !tag.startsWith('ext-') && /\d{3}[^0-9]?\d{3}[^0-9]?\d{4}/.test(tag || ''));
        const phoneLabel = rawPhone || barePhoneTag || (extensionTag ? `Ext ${extensionTag.replace(/^ext-/, '')}` : '');
        const titleTags = tags.filter((tag) => tag && tag !== extensionTag);
        const metaChips = [...titleTags, ...(extensionTag ? [extensionTag] : [])];

        return (
            <Card className="person-card tooltip-person-card">
                <div className="person-card__header">
                    <div className="person-main">
                        <div className="person-name">{person.displayName}</div>
                        {person.email && (
                            <a className="person-email" href={`mailto:${person.email}`}>
                                {person.email}
                            </a>
                        )}
                        {phoneLabel && (
                            <div className="person-phone">{phoneLabel}</div>
                        )}
                        {metaChips.length > 0 && (
                            <div className="meta-chip-row">
                                {metaChips.map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                        {tags.length > metaChips.length && (
                            <div className="tag-row">
                                {tags.filter((tag) => !metaChips.includes(tag)).map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="roles">
                    <span className="roles-label">Eligible roles</span>
                    <div className="role-chip-row">
                        {(person.roles || []).map((roleKey) => (
                            <span key={roleKey} className="role-chip">{roleLabel(roleKey)}</span>
                        ))}
                    </div>
                </div>
            </Card>
        );
    };

    const updatePacketItem = (id, updates) => {
        setPacketItems((prev) => prev.map((item) => item.id === id ? { ...item, ...updates } : item));
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
            { id: `custom-${Date.now()}`, label: 'Additional Document', required: false, file: null, custom: true }
        ]));
    };

    const removeCustomDoc = (id) => {
        setPacketItems((prev) => prev.filter((item) => item.id !== id));
    };

    const buildPacket = async () => {
        setPacketError('');
        setPacketBusy(true);
        try {
            const missing = packetItems.filter((item) => item.required && !item.file);
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
        } catch (error) {
            console.error(error);
            setPacketError('Unable to build the vestry packet.');
        } finally {
            setPacketBusy(false);
        }
    };

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

    useEffect(() => {
        const defaults = buildDefaultReasons(quarterLabel);
        setCertificateAmounts((prev) => ({
            monthly: {
                ...prev.monthly,
                fundAReason: prev.monthly.fundAReason || defaults.monthly.fundAReason,
                fundBReason: prev.monthly.fundBReason || defaults.monthly.fundBReason
            },
            quarterly: {
                ...prev.quarterly,
                fundAReason: prev.quarterly.fundAReason || defaults.quarterly.fundAReason,
                fundBReason: prev.quarterly.fundBReason || defaults.quarterly.fundBReason,
                fidelityReason: prev.quarterly.fidelityReason || defaults.quarterly.fidelityReason
            }
        }));
    }, [quarterLabel]);

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
            .filter((item) => item.phase === 'Vestry Package')
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
                file: prevById.get(doc.id)?.file || null
            }));
            const checklistItemsMapped = packetChecklistDocs.map((doc) => ({
                ...doc,
                file: prevById.get(doc.id)?.file || null
            }));
            return [...baseItems, ...checklistItemsMapped, ...customItems];
        });
    }, [packetChecklistDocs]);

    const checklistGroups = useMemo(() => {
        const phases = ['Pre-Vestry', 'Vestry Package', 'Post-Vestry'];
        const grouped = phases.map((phase) => ({
            phase,
            items: checklistItems.filter((item) => {
                if (phase !== 'Vestry Package') return item.phase === phase;
                return item.phase === phase && !item.task.toLowerCase().includes('certificate');
            })
        }));
        const other = checklistItems.filter((item) => !phases.includes(item.phase));
        if (other.length) grouped.push({ phase: 'Other', items: other });
        return grouped
            .filter((group) => group.items.length > 0);
    }, [checklistItems]);

    const certificateItems = useMemo(() => {
        return checklistItems.filter((item) =>
            item.phase === 'Vestry Package' && item.task.toLowerCase().includes('certificate')
        );
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

    const formatCurrency = (value) => {
        if (!value) return '';
        const numeric = Number.parseFloat(String(value).replace(/[^0-9.]/g, ''));
        if (Number.isNaN(numeric)) return '';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(numeric);
    };

    const updateCertificateAmount = (groupKey, fieldKey, value) => {
        setCertificateAmounts((prev) => ({
            ...prev,
            [groupKey]: {
                ...prev[groupKey],
                [fieldKey]: value
            }
        }));
    };

    const completedCount = checklistItems.filter((item) => checklistProgress[item.id]).length;
    const requiredDocs = packetItems.filter((item) => item.required);
    const requiredUploaded = requiredDocs.filter((item) => item.file).length;
    const optionalUploaded = packetItems.filter((item) => !item.required && item.file).length;

    return (
        <div className="page-vestry">
            <header className="vestry-header">
                <div>
                    <p className="page-kicker">Vestry planning</p>
                    <h1>Vestry</h1>
                    <p className="page-subtitle">
                        Track members, meeting cadence, committee schedules, and packet documents.
                    </p>
                </div>
            </header>

            <Card className="vestry-panel full-span vestry-members-panel">
                <div className="panel-header compact badge-corner">
                    <span className="count-badge" aria-label={`${vestryMembers.length} vestry members`}>
                        {vestryMembers.length}
                    </span>
                </div>
                <div className="pill-row">
                    {vestryMembers.length === 0 ? (
                        <span className="text-muted">No vestry members assigned.</span>
                    ) : (
                        sortedVestryMembers.map((member) => (
                            <span
                                key={member.id}
                                className={`person-chip-wrapper ${openTooltipKey === member.id ? 'tooltip-open' : ''}`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenTooltipKey((prev) => (prev === member.id ? null : member.id));
                                }}
                            >
                                <span className={`person-chip person-chip-${member.category || 'volunteer'}`}>
                                    {member.displayName}
                                </span>
                                <span className={`person-tooltip ${openTooltipKey === member.id ? 'open' : ''}`}>
                                    {renderTooltipCard(member)}
                                </span>
                            </span>
                        ))
                    )}
                </div>
            </Card>

            <div className="vestry-grid">
                <Card className="vestry-panel vestry-checklist-card vestry-row-card">
                    <div className="panel-header compact badge-corner">
                        <h2>{`Checklist${selectedMeeting ? `: ${format(selectedMeeting, 'MMMM')}` : ''}`}</h2>
                        <span className="count-badge" aria-label={`${completedCount} of ${checklistItems.length} complete`}>
                            {completedCount}/{checklistItems.length}
                        </span>
                    </div>
                    <div className="vestry-checklist-panel">
                        {checklistItems.length === 0 ? (
                            <span className="text-muted">No checklist items found for this meeting.</span>
                        ) : (
                            checklistGroups.map((group) => (
                                <div key={group.phase} className="vestry-checklist-group">
                                    <div className="vestry-checklist-title">{group.phase}</div>
                                    {group.items.map((item) => {
                                        const isComplete = !!checklistProgress[item.id];
                                        return (
                                        <label key={item.id} className={`vestry-checklist-item ${isComplete ? 'completed' : ''}`}>
                                            <span className="vestry-checklist-check">
                                                <input
                                                    className="vestry-checklist-input"
                                                    type="checkbox"
                                                    checked={isComplete}
                                                    onChange={() => setChecklistProgress((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                                                />
                                                <span
                                                    className={`check-badge check-badge--sm vestry-check-badge ${isComplete ? '' : 'check-badge--empty'}`}
                                                    aria-hidden="true"
                                                >
                                                    {isComplete ? '✓' : ''}
                                                </span>
                                            </span>
                                            <span className="vestry-checklist-text">
                                                <span className="vestry-checklist-task">{item.task}</span>
                                                {item.notes && <span className="vestry-checklist-notes">{item.notes}</span>}
                                            </span>
                                        </label>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                </Card>

                <Card className="vestry-panel vestry-row-card">
                    <div className="panel-header compact">
                        <h2>Certificates</h2>
                    </div>
                    <div className="certificate-panel">
                        {certificateItems.length === 0 ? (
                            <span className="text-muted">No certificates listed for this meeting.</span>
                        ) : (
                            <>
                                {certificateGroups.monthly.length > 0 && (
                                    <div className="certificate-group">
                                        <div className="certificate-title">Shared Monthly Expenses</div>
                                        <div className="certificate-fields">
                                            <label className="certificate-field">
                                                <span>Fund A</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="$0.00"
                                                    value={certificateAmounts.monthly.fundA}
                                                    onChange={(event) => updateCertificateAmount('monthly', 'fundA', event.target.value)}
                                                    onBlur={(event) => updateCertificateAmount('monthly', 'fundA', formatCurrency(event.target.value))}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Reason"
                                                    value={certificateAmounts.monthly.fundAReason}
                                                    onChange={(event) => updateCertificateAmount('monthly', 'fundAReason', event.target.value)}
                                                />
                                            </label>
                                            <label className="certificate-field">
                                                <span>Fund B</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="$0.00"
                                                    value={certificateAmounts.monthly.fundB}
                                                    onChange={(event) => updateCertificateAmount('monthly', 'fundB', event.target.value)}
                                                    onBlur={(event) => updateCertificateAmount('monthly', 'fundB', formatCurrency(event.target.value))}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Reason"
                                                    value={certificateAmounts.monthly.fundBReason}
                                                    onChange={(event) => updateCertificateAmount('monthly', 'fundBReason', event.target.value)}
                                                />
                                            </label>
                                        </div>
                                        <button className="btn-secondary certificate-action" type="button">
                                            Generate Certificate
                                        </button>
                                    </div>
                                )}
                                {certificateGroups.quarterly.length > 0 && (
                                    <div className="certificate-group">
                                        <div className="certificate-title">Quarterly Interest Transfers</div>
                                        <div className="certificate-fields">
                                            <label className="certificate-field">
                                                <span>Fund A</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="$0.00"
                                                    value={certificateAmounts.quarterly.fundA}
                                                    onChange={(event) => updateCertificateAmount('quarterly', 'fundA', event.target.value)}
                                                    onBlur={(event) => updateCertificateAmount('quarterly', 'fundA', formatCurrency(event.target.value))}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Reason"
                                                    value={certificateAmounts.quarterly.fundAReason}
                                                    onChange={(event) => updateCertificateAmount('quarterly', 'fundAReason', event.target.value)}
                                                />
                                            </label>
                                            <label className="certificate-field">
                                                <span>Fund B</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="$0.00"
                                                    value={certificateAmounts.quarterly.fundB}
                                                    onChange={(event) => updateCertificateAmount('quarterly', 'fundB', event.target.value)}
                                                    onBlur={(event) => updateCertificateAmount('quarterly', 'fundB', formatCurrency(event.target.value))}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Reason"
                                                    value={certificateAmounts.quarterly.fundBReason}
                                                    onChange={(event) => updateCertificateAmount('quarterly', 'fundBReason', event.target.value)}
                                                />
                                            </label>
                                            <label className="certificate-field">
                                                <span>Fidelity</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="$0.00"
                                                    value={certificateAmounts.quarterly.fidelity}
                                                    onChange={(event) => updateCertificateAmount('quarterly', 'fidelity', event.target.value)}
                                                    onBlur={(event) => updateCertificateAmount('quarterly', 'fidelity', formatCurrency(event.target.value))}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Reason"
                                                    value={certificateAmounts.quarterly.fidelityReason}
                                                    onChange={(event) => updateCertificateAmount('quarterly', 'fidelityReason', event.target.value)}
                                                />
                                            </label>
                                        </div>
                                        <button className="btn-secondary certificate-action" type="button">
                                            Generate Certificate
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </Card>

                <Card className="vestry-panel vestry-row-card">
                    <div className="panel-header compact stack">
                        <h2>Vestry Meetings</h2>
                        <span className="panel-meta">6:30pm in the Library</span>
                    </div>
                    <div className="meeting-list compact">
                        {vestryMeetings.map((meeting) => {
                            const isNext = !!nextMeeting && meeting.toDateString() === nextMeeting.toDateString();
                            const isActive = !!selectedMeeting && meeting.toDateString() === selectedMeeting.toDateString();
                            return (
                                <button
                                    key={meeting.toISOString()}
                                    type="button"
                                    className={`meeting-row ${isNext ? 'next' : ''} ${isActive ? 'active' : ''}`}
                                    onClick={() => setSelectedMeeting(meeting)}
                                >
                                    <div>
                                        <strong>{format(meeting, 'MMMM d, yyyy')}</strong>
                                        <div className="text-muted">
                                            {meeting.getMonth() === 10 || meeting.getMonth() === 11 ? '3rd Thursday' : '4th Thursday'}
                                        </div>
                                    </div>
                                    {isNext && <span className="meeting-tag next-tag">Next</span>}
                                </button>
                            );
                        })}
                    </div>
                </Card>

                <Card className="vestry-panel vestry-row-card">
                    <div className="panel-header compact">
                        <h2>Other Meetings</h2>
                    </div>
                    <div className="meeting-list compact">
                        {otherMeetings.length === 0 && (
                            <span className="text-muted">No other meetings scheduled.</span>
                        )}
                        {otherMeetings.map((meeting) => (
                            <div key={`${meeting.id}-${meeting.date}`} className="meeting-row other-meeting-row">
                                <div>
                                    <strong>{meeting.title}</strong>
                                    <div className="text-muted">
                                        {format(meeting.date, 'MMM d, yyyy')} - {meeting.time || 'All day'} - {meeting.location || 'TBD'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card className="vestry-panel full-span">
                    <div className="packet-header">
                        <div>
                            <h2>{`Next Vestry Packet${coveredMonth ? `: ${coveredMonth} Financials` : ''}`}</h2>
                            <p className="text-muted">Upload each document, reorder if needed, then build a single PDF packet.</p>
                            <div className="packet-summary">
                                Required uploaded: {requiredUploaded}/{requiredDocs.length}. Optional uploaded: {optionalUploaded}.
                            </div>
                        </div>
                        <div className="packet-actions">
                            <button className="btn-secondary" onClick={addCustomDoc}>
                                <FaPlus /> Add Document
                            </button>
                            <button className="btn-primary" onClick={buildPacket} disabled={packetBusy}>
                                {packetBusy ? 'Building...' : 'Build Packet'}
                            </button>
                            {packetUrl && (
                                <>
                                    <a href={packetUrl} download={packetFilename} className="btn-icon" aria-label="Download packet">
                                        <FaDownload />
                                    </a>
                                    <a
                                        className="btn-icon"
                                        href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent('vestry@saintedmunds.org')}&su=${encodeURIComponent('Vestry packet')}&body=${encodeURIComponent(mailtoBody)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label="Send to Vestry"
                                    >
                                        <FaPaperPlane />
                                    </a>
                                </>
                            )}
                        </div>
                    </div>
                    {packetError && <div className="alert error">{packetError}</div>}
                    <div className="packet-list compact">
                        {packetItems.map((item, index) => (
                            <div
                                key={item.id}
                                className={`packet-row compact ${dragOverId === item.id ? 'drag-over' : ''}`}
                                draggable
                                onDragStart={() => setDraggedId(item.id)}
                                onDragEnd={() => {
                                    setDraggedId(null);
                                    setDragOverId(null);
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    if (dragOverId !== item.id) setDragOverId(item.id);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    reorderPacketItems(draggedId, item.id);
                                    setDraggedId(null);
                                    setDragOverId(null);
                                }}
                            >
                                <div className="packet-order">
                                    <span className="drag-handle" aria-hidden="true">::</span>
                                </div>
                                <div className="packet-meta">
                                    {item.custom ? (
                                        <input
                                            type="text"
                                            value={item.label}
                                            onChange={(event) => updatePacketItem(item.id, { label: event.target.value })}
                                        />
                                    ) : (
                                        <span className="packet-label">{item.label}</span>
                                    )}
                                    <div className="packet-status">
                                        {item.required && <span className="packet-required">Required</span>}
                                        <span className={item.file ? 'status-pill ready' : 'status-pill missing'}>
                                            {item.file ? `Uploaded: ${item.file.name}` : 'No file yet'}
                                        </span>
                                    </div>
                                </div>
                                <input
                                    type="file"
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    onChange={(event) => updatePacketItem(item.id, { file: event.target.files?.[0] || null })}
                                />
                            {item.custom && (
                                <button className="btn-link" onClick={() => removeCustomDoc(item.id)}>
                                    <FaTrash />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                </Card>
            </div>
        </div>
    );
};

export default Vestry;
