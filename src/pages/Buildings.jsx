import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { FaPlus, FaTools, FaClipboardList, FaAddressBook, FaClipboardCheck, FaTrash } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import { MAP_AREAS } from '../data/areas';
import './Buildings.css';

const Buildings = () => {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState('repairs');
    const [showModal, setShowModal] = useState(false);
    const [activeArea, setActiveArea] = useState(null);
    const [hoveredArea, setHoveredArea] = useState(null);
    const [buildings, setBuildings] = useState([]);
    const [buildingsError, setBuildingsError] = useState('');

    const [tickets, setTickets] = useState([]);
    const [ticketsLoading, setTicketsLoading] = useState(true);
    const [ticketsError, setTicketsError] = useState('');
    const [showTicketModal, setShowTicketModal] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [pendingTicketScroll, setPendingTicketScroll] = useState(false);
    const ticketsViewRef = useRef(null);
    const [roomsExpanded, setRoomsExpanded] = useState(false);
    const roomsListRef = useRef(null);
    const [roomsHeight, setRoomsHeight] = useState(0);
    const [newTicket, setNewTicket] = useState({
        title: '',
        description: '',
        status: 'new',
        areaIds: []
    });
    const [newNote, setNewNote] = useState('');
    const [newTaskText, setNewTaskText] = useState('');

    const formatCurrency = (value) => {
        if (value === null || value === undefined || value === '') return '';
        const numeric = Number(value);
        if (Number.isNaN(numeric)) return '';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(numeric);
    };

    // Repairs Data
    const [repairs, setRepairs] = useState([
        { id: 1, title: 'Leaky Faucet in Kitchen', description: 'Sink in the main kitchen drips constantly.', status: 'complaint', date: '2025-12-10' },
        { id: 2, title: 'Broken pew kneeler', description: 'Row 4, left side.', status: 'repair', date: '2025-12-15' },
        { id: 3, title: 'HVAC Filter Change', description: 'Routine maintenance.', status: 'complete', date: '2025-11-20' },
    ]);
    const [newRepair, setNewRepair] = useState({ title: '', description: '', status: 'complaint' });

    // Needs Data
    const [needs, setNeeds] = useState([
        { id: 1, text: 'Repaint Parish Hall', priority: 'High' },
        { id: 2, text: 'Replace carpet in Vestry', priority: 'Medium' },
    ]);
    const [newNeed, setNewNeed] = useState('');

    // Vendors Data
    const [vendors, setVendors] = useState([]);
    const [vendorsLoading, setVendorsLoading] = useState(true);
    const [vendorsError, setVendorsError] = useState('');

    const handleRepairSubmit = (e) => {
        e.preventDefault();
        setRepairs([...repairs, { ...newRepair, id: Date.now(), date: new Date().toISOString().split('T')[0] }]);
        setShowModal(false);
        setNewRepair({ title: '', description: '', status: 'complaint' });
    };

    const handleStatusChange = (id, newStatus) => {
        setRepairs(repairs.map(r => r.id === id ? { ...r, status: newStatus } : r));
    };

    const renderRepairs = () => (
        <div className="repairs-view">
            <div className="repairs-grid">
                {repairs.map(r => (
                    <div key={r.id} className={`repair-card status-${r.status}`}>
                        <div className="repair-header">
                            <span className="repair-date">{r.date}</span>
                            <span className="repair-status">{r.status}</span>
                        </div>
                        <h3>{r.title}</h3>
                        <p>{r.description}</p>
                        <div className="repair-actions" style={{ marginTop: '1rem' }}>
                            <select
                                value={r.status}
                                onChange={(e) => handleStatusChange(r.id, e.target.value)}
                                style={{ padding: '5px' }}
                            >
                                <option value="complaint">Complaint</option>
                                <option value="troubleshoot">Troubleshoot</option>
                                <option value="repair">Repair</option>
                                <option value="complete">Complete</option>
                            </select>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderNeeds = () => (
        <Card>
            <div className="needs-list">
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Add new long term need..."
                        style={{ flex: 1, padding: '8px' }}
                        value={newNeed}
                        onChange={e => setNewNeed(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && newNeed) {
                                setNeeds([...needs, { id: Date.now(), text: newNeed, priority: 'Medium' }]);
                                setNewNeed('');
                            }
                        }}
                    />
                    <button className="btn-primary" onClick={() => {
                        if (newNeed) {
                            setNeeds([...needs, { id: Date.now(), text: newNeed, priority: 'Medium' }]);
                            setNewNeed('');
                        }
                    }}>Add</button>
                </div>
                <ul>
                    {needs.map(n => (
                        <li key={n.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                            {n.text} <span style={{ fontSize: '0.8rem', color: '#888' }}>({n.priority})</span>
                        </li>
                    ))}
                </ul>
            </div>
        </Card>
    );

    const renderVendors = () => (
        <Card>
            {vendorsError && <div className="ticket-error">{vendorsError}</div>}
            {vendorsLoading ? (
                <p className="empty-state">Loading preferred vendors...</p>
            ) : vendors.length === 0 ? (
                <p className="empty-state">No preferred vendors available yet.</p>
            ) : (
                <table className="vendors-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th>Service</th>
                            <th>Vendor</th>
                            <th>Contact</th>
                            <th>Phone</th>
                            <th>Email</th>
                            <th>Notes</th>
                            <th>Contract</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vendors.map((vendor) => (
                            <tr key={vendor.id}>
                                <td><span className="category-tag">{vendor.service}</span></td>
                                <td>{vendor.vendor}</td>
                                <td>{vendor.contact || '—'}</td>
                                <td>{vendor.phone || '—'}</td>
                                <td>
                                    {vendor.email ? (
                                        <a href={`mailto:${vendor.email}`}>{vendor.email}</a>
                                    ) : '—'}
                                </td>
                                <td>{vendor.notes || '—'}</td>
                                <td>{vendor.contract || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Card>
    );

    useEffect(() => {
        const loadBuildings = async () => {
            setBuildingsError('');
            try {
                const response = await fetch(`${API_URL}/buildings`);
                if (!response.ok) throw new Error('Failed to load buildings');
                const data = await response.json();
                setBuildings(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Failed to load buildings:', error);
                setBuildingsError('Unable to load building details.');
            }
        };
        loadBuildings();
    }, []);

    useEffect(() => {
        let canceled = false;
        const loadVendors = async () => {
            setVendorsError('');
            setVendorsLoading(true);
            try {
                const response = await fetch(`${API_URL}/vendors`);
                if (!response.ok) throw new Error('Failed to load vendors');
                const data = await response.json();
                if (!canceled) {
                    setVendors(Array.isArray(data) ? data : []);
                }
            } catch (error) {
                console.error('Failed to load preferred vendors:', error);
                if (!canceled) {
                    setVendorsError('Unable to load preferred vendors.');
                }
            } finally {
                if (!canceled) {
                    setVendorsLoading(false);
                }
            }
        };
        loadVendors();
        return () => {
            canceled = true;
        };
    }, []);

    const openTicketModal = (defaultAreaId = null) => {
        const areaIds = defaultAreaId ? [defaultAreaId] : [];
        setNewTicket({ title: '', description: '', status: 'new', areaIds });
        setShowTicketModal(true);
    };

    const toggleTicketArea = (areaId) => {
        setNewTicket((prev) => {
            const exists = prev.areaIds.includes(areaId);
            return {
                ...prev,
                areaIds: exists ? prev.areaIds.filter((id) => id !== areaId) : [...prev.areaIds, areaId]
            };
        });
    };

    const createTicket = async (event) => {
        event.preventDefault();
        if (!newTicket.title.trim()) return;
        try {
            const response = await fetch(`${API_URL}/tickets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newTicket.title,
                    description: newTicket.description,
                    status: newTicket.status,
                    area_ids: newTicket.areaIds
                })
            });
            if (!response.ok) throw new Error('Failed to create ticket');
            const created = await response.json();
            setTickets((prev) => [created, ...prev]);
            setSelectedTicketId(created.id);
            setShowTicketModal(false);
        } catch (error) {
            console.error('Failed to create ticket:', error);
            setTicketsError('Unable to create ticket. Please try again.');
        }
    };

    const updateTicket = async (ticketId, updates) => {
        try {
            const response = await fetch(`${API_URL}/tickets/${ticketId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!response.ok) throw new Error('Failed to update ticket');
            const updated = await response.json();
            setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? updated : ticket)));
        } catch (error) {
            console.error('Failed to update ticket:', error);
            setTicketsError('Unable to update ticket. Please try again.');
        }
    };

    const addTicketNote = async (ticket) => {
        const trimmed = newNote.trim();
        if (!trimmed) return;
        const noteEntry = {
            id: `note-${Date.now()}`,
            text: trimmed,
            created_at: new Date().toISOString()
        };
        await updateTicket(ticket.id, { notes: [...(ticket.notes || []), noteEntry] });
        setNewNote('');
    };

    const addTicketTask = async (ticketId) => {
        const trimmed = newTaskText.trim();
        if (!trimmed) return;
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: trimmed, ticket_id: ticketId })
            });
            if (!response.ok) throw new Error('Failed to add task');
            const created = await response.json();
            setTickets((prev) => prev.map((ticket) => (
                ticket.id === ticketId
                    ? { ...ticket, tasks: [created, ...(ticket.tasks || [])] }
                    : ticket
            )));
            setNewTaskText('');
        } catch (error) {
            console.error('Failed to add task:', error);
            setTicketsError('Unable to add task. Please try again.');
        }
    };

    const toggleTicketTask = async (task) => {
        try {
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: task.text, completed: !task.completed })
            });
            if (!response.ok) throw new Error('Failed to update task');
            const updated = await response.json();
            setTickets((prev) => prev.map((ticket) => (
                ticket.id === task.ticket_id
                    ? { ...ticket, tasks: (ticket.tasks || []).map((item) => (item.id === task.id ? updated : item)) }
                    : ticket
            )));
        } catch (error) {
            console.error('Failed to update task:', error);
            setTicketsError('Unable to update task. Please try again.');
        }
    };

    const deleteTicketTask = async (task) => {
        try {
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete task');
            setTickets((prev) => prev.map((ticket) => (
                ticket.id === task.ticket_id
                    ? { ...ticket, tasks: (ticket.tasks || []).filter((item) => item.id !== task.id) }
                    : ticket
            )));
        } catch (error) {
            console.error('Failed to delete task:', error);
            setTicketsError('Unable to delete task. Please try again.');
        }
    };

    const renderTickets = () => (
        <div className="tickets-view" ref={ticketsViewRef}>
            <div className="tickets-header">
                <div>
                    <h2>Issue Tickets</h2>
                    <p>Track maintenance problems across campus areas.</p>
                </div>
                <button className="btn-primary" onClick={openTicketModal}>
                    <FaPlus /> New Ticket
                </button>
            </div>

            {ticketsError && <div className="ticket-error">{ticketsError}</div>}

            <div className="tickets-layout">
                <Card className="tickets-list">
                    {ticketsLoading && <p className="empty-state">Loading tickets...</p>}
                    {!ticketsLoading && tickets.length === 0 && (
                        <p className="empty-state">No tickets yet.</p>
                    )}
                    {!ticketsLoading && tickets.map((ticket) => (
                        <button
                            key={ticket.id}
                            type="button"
                            className={`ticket-row ${ticket.id === selectedTicketId ? 'active' : ''}`}
                            onClick={() => setSelectedTicketId(ticket.id)}
                        >
                            <div className="ticket-row-header">
                                <h4>{ticket.title}</h4>
                                <span className={`ticket-status status-${ticket.status}`}>{ticket.status.replace('_', ' ')}</span>
                            </div>
                            <p>{ticket.description || 'No description'}</p>
                            <div className="ticket-area-chips">
                                {(ticket.areas || []).map((areaId) => (
                                    <span key={areaId} className="ticket-area-chip">
                                        {areaById[areaId]?.name || areaId}
                                    </span>
                                ))}
                            </div>
                        </button>
                    ))}
                </Card>

                <Card className="ticket-detail">
                    {!selectedTicket && <p className="empty-state">Select a ticket to view details.</p>}
                    {selectedTicket && (
                        <>
                            <div className="ticket-detail-header">
                                <div>
                                    <h3>{selectedTicket.title}</h3>
                                    <p>{selectedTicket.description}</p>
                                </div>
                                <select
                                    value={selectedTicket.status}
                                    onChange={(event) => updateTicket(selectedTicket.id, { status: event.target.value })}
                                >
                                    <option value="new">New</option>
                                    <option value="reviewed">Reviewed</option>
                                    <option value="in_process">In Process</option>
                                    <option value="closed">Closed</option>
                                </select>
                            </div>

                            <div className="ticket-section">
                                <h4>Areas</h4>
                                <div className="ticket-area-chips">
                                    {(selectedTicket.areas || []).map((areaId) => (
                                        <span key={areaId} className="ticket-area-chip">
                                            {areaById[areaId]?.name || areaId}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="ticket-section" id="ticket-tasks">
                                <h4>Tasks</h4>
                                <div className="ticket-task-form">
                                    <input
                                        type="text"
                                        placeholder="Add task linked to this ticket..."
                                        value={newTaskText}
                                        onChange={(event) => setNewTaskText(event.target.value)}
                                    />
                                    <button className="btn-secondary" onClick={() => addTicketTask(selectedTicket.id)}>
                                        Add Task
                                    </button>
                                </div>
                                <ul className="ticket-task-list">
                                    {(selectedTicket.tasks || []).length === 0 && (
                                        <li className="empty-state">No tasks added.</li>
                                    )}
                                    {(selectedTicket.tasks || []).map((task) => (
                                        <li key={task.id} className={`ticket-task ${task.completed ? 'completed' : ''}`}>
                                            <button
                                                type="button"
                                                className="task-toggle"
                                                onClick={() => toggleTicketTask(task)}
                                            >
                                                {task.completed ? <FaClipboardCheck /> : <span />}
                                            </button>
                                            <span>{task.text}</span>
                                            <button
                                                type="button"
                                                className="btn-delete"
                                                onClick={() => deleteTicketTask(task)}
                                            >
                                                <FaTrash />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="ticket-section">
                                <h4>Notes</h4>
                                <div className="ticket-note-form">
                                    <textarea
                                        rows="2"
                                        placeholder="Add note with status updates or details..."
                                        value={newNote}
                                        onChange={(event) => setNewNote(event.target.value)}
                                    />
                                    <button className="btn-secondary" onClick={() => addTicketNote(selectedTicket)}>
                                        Add Note
                                    </button>
                                </div>
                                <ul className="ticket-note-list">
                                    {(selectedTicket.notes || []).length === 0 && (
                                        <li className="empty-state">No notes yet.</li>
                                    )}
                                    {(selectedTicket.notes || []).map((note) => (
                                        <li key={note.id}>
                                            <span>{note.text}</span>
                                            <em>{new Date(note.created_at).toLocaleString()}</em>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    )}
                </Card>
            </div>
        </div>
    );

    const buildingsById = useMemo(() => {
        return new Map(buildings.map((building) => [building.id, building]));
    }, [buildings]);

    const mapAreas = useMemo(() => {
        return MAP_AREAS.map((area) => {
            if (area.type !== 'building') return area;
            const building = buildingsById.get(area.id);
            if (!building) return area;
            return {
                ...area,
                name: building.name || area.name,
                category: building.category || area.category,
                description: building.notes || area.description
            };
        });
    }, [buildingsById]);

    const activeDetails = useMemo(() => {
        const current = hoveredArea || activeArea || null;
        if (!current) return null;
        const match = mapAreas.find((area) => area.id === current.id);
        return match || current;
    }, [hoveredArea, activeArea, mapAreas]);

    const activeBuilding = activeDetails?.type === 'building'
        ? buildingsById.get(activeDetails.id)
        : null;
    useLayoutEffect(() => {
        if (!roomsListRef.current) {
            setRoomsHeight(0);
            return;
        }
        const measured = roomsListRef.current.scrollHeight;
        setRoomsHeight(roomsExpanded ? measured : 0);
    }, [roomsExpanded, activeBuilding?.rooms?.length]);

    useEffect(() => {
        setRoomsExpanded(false);
    }, [activeDetails?.id]);

    const clearSelection = () => {
        setHoveredArea(null);
        setActiveArea(null);
    };

    const shouldIgnoreDeselect = (target) => {
        if (!target) return false;
        if (target.closest('.campus-map-image')) return true;
        if (target.closest('.map-area')) return true;
        if (target.closest('.campus-map-details')) return true;
        if (target.closest('button, input, select, textarea, a, label')) return true;
        return false;
    };

    const orderedAreas = useMemo(() => {
        const priority = ['Worship', 'All Purpose'];
        const buildingBuckets = new Map(priority.map((value) => [value, []]));
        const rest = [];

        mapAreas.forEach((area) => {
            if (area.category && buildingBuckets.has(area.category)) {
                buildingBuckets.get(area.category).push(area);
                return;
            }
            rest.push(area);
        });

        return [
            ...priority.flatMap((key) => buildingBuckets.get(key)),
            ...rest
        ];
    }, [mapAreas]);

    const areaById = useMemo(() => {
        return mapAreas.reduce((acc, area) => {
            acc[area.id] = area;
            return acc;
        }, {});
    }, [mapAreas]);

    const activeAreaTickets = useMemo(() => {
        if (!activeDetails?.id) return [];
        return tickets.filter((ticket) => (
            (ticket.areas || []).includes(activeDetails.id) && ticket.status !== 'closed'
        ));
    }, [activeDetails, tickets]);

    const focusTicket = (ticketId) => {
        setSelectedTicketId(ticketId);
        setActiveTab('tickets');
        setPendingTicketScroll(true);
    };

    useEffect(() => {
        const loadTickets = async () => {
            setTicketsLoading(true);
            setTicketsError('');
            try {
                const response = await fetch(`${API_URL}/tickets`);
                if (!response.ok) throw new Error('Failed to load tickets');
                const data = await response.json();
                setTickets(Array.isArray(data) ? data : []);
                if (!selectedTicketId && Array.isArray(data) && data.length > 0) {
                    setSelectedTicketId(data[0].id);
                }
            } catch (error) {
                console.error('Failed to load tickets:', error);
                setTicketsError('Unable to load tickets. Please refresh and try again.');
            } finally {
                setTicketsLoading(false);
            }
        };

        loadTickets();
    }, [selectedTicketId]);

    const tasksScrollRef = useRef(null);

    useEffect(() => {
        const ticketParam = searchParams.get('ticket');
        if (!ticketParam || tickets.length === 0) return;
        const match = tickets.find((ticket) => `${ticket.id}` === ticketParam);
        if (!match) return;
        setSelectedTicketId(match.id);
        setActiveTab('tickets');
        setPendingTicketScroll(true);
    }, [searchParams, tickets]);

    useEffect(() => {
        if (location.hash !== '#ticket-tasks') return;
        if (!selectedTicketId || activeTab !== 'tickets') return;
        if (tasksScrollRef.current === selectedTicketId) return;
        const node = document.getElementById('ticket-tasks');
        if (node) {
            node.scrollIntoView({ behavior: 'smooth', block: 'start' });
            tasksScrollRef.current = selectedTicketId;
        }
    }, [activeTab, location.hash, selectedTicketId]);

    useEffect(() => {
        if (!pendingTicketScroll || activeTab !== 'tickets') return;
        const node = ticketsViewRef.current;
        if (node) {
            node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setPendingTicketScroll(false);
    }, [pendingTicketScroll, activeTab, selectedTicketId]);

    const selectedTicket = useMemo(() => {
        return tickets.find((ticket) => ticket.id === selectedTicketId) || null;
    }, [tickets, selectedTicketId]);

    return (
        <div
            className="page-buildings"
            onClickCapture={(event) => {
                if (!shouldIgnoreDeselect(event.target)) {
                    clearSelection();
                }
            }}
        >
            <header className="buildings-header">
                <h1>Buildings & Grounds</h1>
                <button className="btn-primary" onClick={() => openTicketModal(activeArea?.id)}>
                    <FaPlus /> Open Ticket
                </button>
            </header>

            <Card className="campus-map-card">
                <div className="campus-map-layout">
                    <Card
                        className="campus-map-panel campus-map-list-panel"
                        onMouseLeave={() => setHoveredArea(null)}
                    >
                        <h3>Locations</h3>
                        <div className="map-list">
                            {orderedAreas.map((area) => {
                                const categoryKey = area.category
                                    ? area.category.toLowerCase().replace(/\s+/g, '-')
                                    : '';
                                const isSelected = activeArea?.id === area.id;
                                const isHovered = hoveredArea?.id === area.id;
                                return (
                                    <button
                                        key={area.id}
                                        type="button"
                                        className={`map-list-item ${isSelected ? 'selected' : ''} ${isHovered ? 'active' : ''}`}
                                        onMouseEnter={() => setHoveredArea(area)}
                                        onFocus={() => setHoveredArea(area)}
                                        onClick={() => setActiveArea(area)}
                                    >
                                        <span
                                            className={`map-dot map-dot-${area.type} ${categoryKey ? `map-dot-${categoryKey}` : ''}`}
                                        />
                                        {area.name}
                                    </button>
                                );
                            })}
                        </div>
                    </Card>
                    <div
                        className="campus-map-wrapper"
                        onMouseLeave={() => setHoveredArea(null)}
                    >
                        <img src="/map.png" alt="Campus map" className="campus-map-image" />
                        <div className="campus-map-overlay">
                            <svg
                                className="campus-map-svg"
                                viewBox="0 0 554 1504"
                                preserveAspectRatio="xMidYMid meet"
                            >
                                {mapAreas.map((area) => {
                                    const isActive = hoveredArea?.id === area.id || activeArea?.id === area.id;
                                    const categoryKey = area.category
                                        ? area.category.toLowerCase().replace(/\s+/g, '-')
                                        : '';
                                    const className = `map-area map-area-${area.type} ${categoryKey ? `map-area-category-${categoryKey}` : ''} ${isActive ? 'active' : ''}`;

                                    if (area.shape === 'poly') {
                                        const points = area.points.map(pair => pair.join(',')).join(' ');
                                        return (
                                            <polygon
                                                key={area.id}
                                                className={className}
                                                points={points}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={area.name}
                                                onMouseEnter={() => setHoveredArea(area)}
                                                onFocus={() => setHoveredArea(area)}
                                                onMouseLeave={() => setHoveredArea(null)}
                                                onBlur={() => setHoveredArea(null)}
                                                onClick={() => setActiveArea(area)}
                                            >
                                                <title>{area.name}</title>
                                            </polygon>
                                        );
                                    }

                                    return (
                                        <rect
                                            key={area.id}
                                            className={className}
                                            x={area.rect.x}
                                            y={area.rect.y}
                                            width={area.rect.width}
                                            height={area.rect.height}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={area.name}
                                            onMouseEnter={() => setHoveredArea(area)}
                                            onFocus={() => setHoveredArea(area)}
                                            onMouseLeave={() => setHoveredArea(null)}
                                            onBlur={() => setHoveredArea(null)}
                                            onClick={() => setActiveArea(area)}
                                        >
                                            <title>{area.name}</title>
                                        </rect>
                                    );
                                })}
                            </svg>
                        </div>
                    </div>
                    <Card
                        className="campus-map-panel campus-map-details"
                        onClickCapture={(event) => event.stopPropagation()}
                    >
                        {!activeDetails && (
                            <div className="map-empty">
                                <h3>Pick a location</h3>
                                <p>Click on an area of the map to view details.</p>
                            </div>
                        )}
                        {activeDetails && (
                            <>
                                <div className="map-pill-row">
                                    <span className={`pill map-tag map-tag-${activeDetails?.type || 'building'}`}>
                                        {activeDetails?.type === 'parking' ? 'Parking' : activeDetails?.type === 'grounds' ? 'Grounds' : activeDetails?.type === 'entry' ? 'Entry' : 'Building'}
                                    </span>
                                    {activeDetails?.category && (
                                        <span className={`pill map-category map-category-${activeDetails.category.toLowerCase().replace(/\s+/g, '-')}`}>
                                            {activeDetails.category}
                                        </span>
                                    )}
                                </div>
                                <h3>{activeDetails?.name}</h3>
                                <p>{activeDetails?.description}</p>
                                {buildingsError && (
                                    <div className="map-note">{buildingsError}</div>
                                )}
                                {activeBuilding && (
                                    <div className="building-info">
                                        <div className="building-stats">
                                            {activeBuilding.capacity ? (
                                                <div className="building-stat">
                                                    <span>Capacity</span>
                                                    <strong>{activeBuilding.capacity}</strong>
                                                </div>
                                            ) : null}
                                            {activeBuilding.rental_rate_hour ? (
                                                <div className="building-stat">
                                                    <span>Hourly rate</span>
                                                    <strong>{formatCurrency(activeBuilding.rental_rate_hour)}</strong>
                                                </div>
                                            ) : null}
                                            {activeBuilding.rental_rate_day ? (
                                                <div className="building-stat">
                                                    <span>Rental rate</span>
                                                    <strong>{formatCurrency(activeBuilding.rental_rate_day)}</strong>
                                                </div>
                                            ) : null}
                                            {activeBuilding.rental_rate && !activeBuilding.rental_rate_day && !activeBuilding.rental_rate_hour ? (
                                                <div className="building-stat">
                                                    <span>Rental rate</span>
                                                    <strong>{formatCurrency(activeBuilding.rental_rate)}</strong>
                                                </div>
                                            ) : null}
                                            {activeBuilding.parking_spaces ? (
                                                <div className="building-stat">
                                                    <span>Parking</span>
                                                    <strong>{activeBuilding.parking_spaces}</strong>
                                                </div>
                                            ) : null}
                                        </div>
                                        {Array.isArray(activeBuilding.rooms) && activeBuilding.rooms.length > 0 && (
                                            <div className="rooms-section">
                                                <div className="rooms-header">
                                                    <button
                                                        type="button"
                                                        className="rooms-header-toggle"
                                                        onClick={() => setRoomsExpanded((prev) => !prev)}
                                                        aria-expanded={roomsExpanded}
                                                    >
                                                        <span>Rooms</span>
                                                        <span className={`rooms-caret ${roomsExpanded ? 'open' : ''}`} aria-hidden="true">
                                                            ▾
                                                        </span>
                                                    </button>
                                                    <span className="rooms-count">
                                                        {activeBuilding.rooms.length} rooms
                                                    </span>
                                                </div>
                                                <div
                                                    className={`rooms-list-wrapper ${roomsExpanded ? 'expanded' : ''}`}
                                                    aria-hidden={!roomsExpanded}
                                                    style={{ '--rooms-height': `${roomsHeight}px` }}
                                                >
                                                    {(() => {
                                                        const floors = Array.from(
                                                            new Set(
                                                                activeBuilding.rooms
                                                                    .map((room) => room.floor)
                                                                    .filter((floor) => floor !== null && floor !== '')
                                                            )
                                                        );
                                                        const showFloor = floors.length > 1;
                                                        const floorLabel = (floor) => {
                                                            if (floor === 0) return 'Basement';
                                                            if (floor === 1) return 'First Floor';
                                                            if (floor === 2) return 'Second Floor';
                                                            return `Floor ${floor}`;
                                                        };
                                                        const sortedRooms = [...activeBuilding.rooms].sort((a, b) => {
                                                            const aHasRate = a.rental_rate ? 1 : 0;
                                                            const bHasRate = b.rental_rate ? 1 : 0;
                                                            if (aHasRate !== bHasRate) return bHasRate - aHasRate;
                                                            const aFloor = a.floor === null || a.floor === '' ? -1 : Number(a.floor);
                                                            const bFloor = b.floor === null || b.floor === '' ? -1 : Number(b.floor);
                                                            if (aFloor !== bFloor) return bFloor - aFloor;
                                                            return (a.name || '').localeCompare(b.name || '');
                                                        });
                                                        return (
                                                            <div className="rooms-list" ref={roomsListRef}>
                                                                {sortedRooms.map((room) => (
                                                                    <div key={room.id} className="room-row">
                                                                        <div>
                                                                            <div className="room-name">{room.name}</div>
                                                                            <div className="room-meta">
                                                                                {showFloor && room.floor !== null && room.floor !== '' ? (
                                                                                    <span>{floorLabel(room.floor)}</span>
                                                                                ) : null}
                                                                                {room.capacity ? <span>{room.capacity} seats</span> : null}
                                                                            </div>
                                                                        </div>
                                                                        {room.rental_rate ? (
                                                                            <span className="room-rate">{formatCurrency(room.rental_rate)}</span>
                                                                        ) : null}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeAreaTickets.length > 0 && (
                                    <div className="map-ticket-section">
                                        <h4>Active Tickets</h4>
                                        <div className="map-ticket-list">
                                            {activeAreaTickets.map((ticket) => (
                                                <button
                                                    key={ticket.id}
                                                    type="button"
                                                    className="map-ticket-button"
                                                    onClick={() => focusTicket(ticket.id)}
                                                >
                                                    <div className="map-ticket-header">
                                                        <h5>{ticket.title}</h5>
                                                        <span className={`ticket-status status-${ticket.status}`}>
                                                            {ticket.status.replace('_', ' ')}
                                                        </span>
                                                    </div>
                                                    <p>{ticket.description || 'No description'}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </Card>
                </div>
            </Card>

            <div className="buildings-tabs">
                <button className={`tab-btn ${activeTab === 'repairs' ? 'active' : ''}`} onClick={() => setActiveTab('repairs')}>
                    <FaTools /> Repairs
                </button>
                <button className={`tab-btn ${activeTab === 'needs' ? 'active' : ''}`} onClick={() => setActiveTab('needs')}>
                    <FaClipboardList /> Long Term Needs
                </button>
                <button className={`tab-btn ${activeTab === 'vendors' ? 'active' : ''}`} onClick={() => setActiveTab('vendors')}>
                    <FaAddressBook /> Preferred Vendors
                </button>
                <button className={`tab-btn ${activeTab === 'tickets' ? 'active' : ''}`} onClick={() => setActiveTab('tickets')}>
                    <FaClipboardList /> Tickets
                </button>
            </div>

            {activeTab === 'repairs' && renderRepairs()}
            {activeTab === 'needs' && renderNeeds()}
            {activeTab === 'vendors' && renderVendors()}
            {activeTab === 'tickets' && renderTickets()}

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title="Report Repair Issue"
            >
                <form className="event-form" onSubmit={handleRepairSubmit}>
                    <div className="form-group">
                        <label>Issue Title</label>
                        <input
                            type="text"
                            required
                            value={newRepair.title}
                            onChange={(e) => setNewRepair({ ...newRepair, title: e.target.value })}
                            placeholder="e.g. Broken Window"
                        />
                    </div>
                    <div className="form-group">
                        <label>Description</label>
                        <textarea
                            required
                            rows="3"
                            value={newRepair.description}
                            onChange={(e) => setNewRepair({ ...newRepair, description: e.target.value })}
                            placeholder="Details about the location and issue..."
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Submit Report</button>
                    </div>
                </form>
            </Modal>

            <Modal
                isOpen={showTicketModal}
                onClose={() => setShowTicketModal(false)}
                title="Create New Ticket"
            >
                <form className="ticket-form" onSubmit={createTicket}>
                    <div className="form-group">
                        <label>Title</label>
                        <input
                            type="text"
                            required
                            value={newTicket.title}
                            onChange={(event) => setNewTicket({ ...newTicket, title: event.target.value })}
                            placeholder="e.g. Flooding near Fellowship Hall"
                        />
                    </div>
                    <div className="form-group">
                        <label>Description</label>
                        <textarea
                            rows="3"
                            value={newTicket.description}
                            onChange={(event) => setNewTicket({ ...newTicket, description: event.target.value })}
                            placeholder="Describe the issue and impact."
                        />
                    </div>
                    <div className="form-group">
                        <label>Status</label>
                        <select
                            value={newTicket.status}
                            onChange={(event) => setNewTicket({ ...newTicket, status: event.target.value })}
                        >
                            <option value="new">New</option>
                            <option value="reviewed">Reviewed</option>
                            <option value="in_process">In Process</option>
                            <option value="closed">Closed</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Areas</label>
                        <div className="ticket-area-grid">
                            {mapAreas.map((area) => (
                                <label key={area.id} className="ticket-area-option">
                                    <input
                                        type="checkbox"
                                        checked={newTicket.areaIds.includes(area.id)}
                                        onChange={() => toggleTicketArea(area.id)}
                                    />
                                    <span>{area.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowTicketModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Create Ticket</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Buildings;
