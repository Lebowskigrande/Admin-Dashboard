import { useEffect, useMemo, useState } from 'react';
import { FaPlus, FaTrash } from 'react-icons/fa';
import { addMonths, format } from 'date-fns';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { getVestryDetails, saveVestryDetails } from '../services/vestryDetails';
import './Vestry.css';

const BASE_PACKET_DOCS = [
    { id: 'agenda', label: 'Agenda', required: true },
    { id: 'minutes', label: 'Previous Minutes', required: true },
    { id: 'treasurer', label: 'Treasurer Report', required: true },
    { id: 'church-pl', label: 'Church P&L', required: true },
    { id: 'church-bs', label: 'Church Balance Sheet', required: true },
    { id: 'joint-ledger', label: 'Joint Ledger', required: true },
    { id: 'pledge-status', label: 'Pledge Status Report', required: true },
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
    const [vestryMembers, setVestryMembers] = useState([]);
    const [committeeMeetings, setCommitteeMeetings] = useState(getVestryDetails().committeeMeetings || []);
    const [checklistItems, setChecklistItems] = useState([]);
    const [checklistProgress, setChecklistProgress] = useState(getVestryDetails().checklistProgress || {});
    const [packetItems, setPacketItems] = useState(BASE_PACKET_DOCS.map((doc) => ({ ...doc, file: null })));
    const [packetBusy, setPacketBusy] = useState(false);
    const [packetError, setPacketError] = useState('');
    const [packetUrl, setPacketUrl] = useState('');
    const [draggedId, setDraggedId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);

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
        saveVestryDetails({ committeeMeetings, checklistProgress });
    }, [committeeMeetings, checklistProgress]);

    useEffect(() => {
        return () => {
            if (packetUrl) URL.revokeObjectURL(packetUrl);
        };
    }, [packetUrl]);

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

    useEffect(() => {
        setSelectedMeeting((prev) => prev || nextMeeting);
    }, [nextMeeting]);

    const coveredMonth = selectedMeeting ? format(addMonths(selectedMeeting, -1), 'MMMM') : '';
    const checklistMonth = selectedMeeting ? selectedMeeting.getMonth() + 1 : null;

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

    const checklistGroups = useMemo(() => {
        const phases = ['Pre-Vestry', 'Vestry Package', 'Post-Vestry'];
        const grouped = phases.map((phase) => ({
            phase,
            items: checklistItems.filter((item) => item.phase === phase)
        }));
        const other = checklistItems.filter((item) => !phases.includes(item.phase));
        if (other.length) grouped.push({ phase: 'Other', items: other });
        return grouped;
    }, [checklistItems]);

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

            <div className="vestry-grid">
                <Card className="vestry-panel">
                    <div className="panel-header compact">
                        <h2>{`Vestry Checklist${selectedMeeting ? `: ${format(selectedMeeting, 'MMMM')}` : ''}`}</h2>
                        <span className="panel-meta">{completedCount}/{checklistItems.length} done</span>
                    </div>
                    <div className="vestry-checklist-panel">
                        {checklistItems.length === 0 ? (
                            <span className="text-muted">No checklist items found for this meeting.</span>
                        ) : (
                            checklistGroups.map((group) => (
                                <div key={group.phase} className="vestry-checklist-group">
                                    <div className="vestry-checklist-title">{group.phase}</div>
                                    {group.items.map((item) => (
                                        <label key={item.id} className="vestry-checklist-item">
                                            <input
                                                type="checkbox"
                                                checked={!!checklistProgress[item.id]}
                                                onChange={() => setChecklistProgress((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                                            />
                                            <span className="vestry-checklist-text">
                                                <span className="vestry-checklist-task">{item.task}</span>
                                                {item.notes && <span className="vestry-checklist-notes">{item.notes}</span>}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </Card>

                <Card className="vestry-panel">
                    <div className="panel-header compact">
                        <h2>Vestry Meetings</h2>
                        <span className="panel-meta">Default: 6:30 PM - Library</span>
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

                <Card className="vestry-panel">
                    <div className="panel-header compact">
                        <h2>Committee Meetings</h2>
                        <button className="btn-secondary btn-compact" onClick={() => setCommitteeMeetings((prev) => [...prev, { name: '', date: '', time: '', location: '' }])}>
                            <FaPlus /> Add Meeting
                        </button>
                    </div>
                    <div className="committee-grid compact">
                        {committeeMeetings.length === 0 && (
                            <span className="text-muted">No committee meetings scheduled.</span>
                        )}
                        {committeeMeetings.map((meeting, index) => (
                            <div key={`committee-${index}`} className="committee-row">
                                <input
                                    type="text"
                                    placeholder="Committee name"
                                    value={meeting.name}
                                    onChange={(event) => {
                                        const next = [...committeeMeetings];
                                        next[index] = { ...next[index], name: event.target.value };
                                        setCommitteeMeetings(next);
                                    }}
                                />
                                <input
                                    type="date"
                                    value={meeting.date}
                                    onChange={(event) => {
                                        const next = [...committeeMeetings];
                                        next[index] = { ...next[index], date: event.target.value };
                                        setCommitteeMeetings(next);
                                    }}
                                />
                                <input
                                    type="time"
                                    value={meeting.time}
                                    onChange={(event) => {
                                        const next = [...committeeMeetings];
                                        next[index] = { ...next[index], time: event.target.value };
                                        setCommitteeMeetings(next);
                                    }}
                                />
                                <input
                                    type="text"
                                    placeholder="Location"
                                    value={meeting.location}
                                    onChange={(event) => {
                                        const next = [...committeeMeetings];
                                        next[index] = { ...next[index], location: event.target.value };
                                        setCommitteeMeetings(next);
                                    }}
                                />
                                <button className="btn-link" onClick={() => setCommitteeMeetings((prev) => prev.filter((_, i) => i !== index))}>
                                    <FaTrash />
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card className="vestry-panel">
                    <div className="panel-header compact">
                        <h2>Vestry Members</h2>
                        <span className="panel-meta">{vestryMembers.length} total</span>
                    </div>
                    <div className="pill-row">
                        {vestryMembers.length === 0 ? (
                            <span className="text-muted">No vestry members assigned.</span>
                        ) : (
                            vestryMembers.map((member) => (
                                <span key={member.id} className="pill vestry-pill">{member.displayName}</span>
                            ))
                        )}
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
                                    accept="application/pdf"
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
                    {packetUrl && (
                        <div className="packet-download">
                            <a href={packetUrl} download="vestry-packet.pdf" className="btn-secondary">
                                Download Packet
                            </a>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default Vestry;
