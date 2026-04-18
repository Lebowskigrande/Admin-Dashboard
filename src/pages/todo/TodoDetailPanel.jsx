import { useEffect, useMemo, useState } from 'react';
import { FaCheck, FaExternalLinkAlt, FaRedoAlt } from 'react-icons/fa';

import Card from '../../components/Card';
import { API_URL } from '../../services/apiConfig';
import { APP_ROUTES } from '../../config/appRoutes';
import { getTaskCycleChipText, getTaskCycleLabel, getTaskCycleState } from '../../../shared/taskStatus.js';
import { getSectionIconComponent } from './todoVisuals';
import { buildEventEditorDraft, renderPanelContent } from './todoDetailPanelContent';

const TodoDetailPanel = ({ selectedOrigin, selectedWorkPackage, selectedSection, selectedOriginTitle, selectedOriginSubtitle, selectedSectionKey, focusTask, setSelectedSectionKey, setSelectedTaskId, ensureTaskInProgress, markTaskDone, resetTaskState, getOriginColorClass, getOriginLink, refreshEvents, reloadTasks }) => {
    const [panelData, setPanelData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [panelRefreshTick, setPanelRefreshTick] = useState(0);
    const [eventDetails, setEventDetails] = useState(null);
    const [eventDraft, setEventDraft] = useState(null);
    const [eventDraftBaseline, setEventDraftBaseline] = useState('');
    const [eventSaving, setEventSaving] = useState(false);
    const [eventSaveError, setEventSaveError] = useState('');
    const originRoute = useMemo(() => (selectedOrigin ? getOriginLink(selectedOrigin) : APP_ROUTES.todo), [getOriginLink, selectedOrigin]);

    useEffect(() => {
        if (!selectedOrigin) {
            setPanelData(null);
            setError('');
            return undefined;
        }
        let cancelled = false;
        const controller = new AbortController();
        const loadPanel = async () => {
            setLoading(true);
            setError('');
            try {
                const params = new URLSearchParams({
                    origin_type: selectedOrigin.origin_type || '',
                    origin_id: selectedOrigin.origin_id || '',
                    section_key: selectedSection?.key || '',
                    task_id: focusTask?.id || ''
                });
                const response = await fetch(`${API_URL}/tasks/panel-data?${params.toString()}`, { signal: controller.signal });
                if (!response.ok) throw new Error('Failed to load task data');
                const payload = await response.json();
                if (!cancelled) setPanelData(payload);
            } catch (loadError) {
                if (!cancelled && loadError?.name !== 'AbortError') {
                    console.error('Task panel load failed:', loadError);
                    setError('Unable to load task data.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadPanel();
        const shouldPoll = (selectedSection?.key || '') === 'orders';
        const timer = shouldPoll ? window.setInterval(loadPanel, 5 * 60 * 1000) : null;
        return () => {
            cancelled = true;
            controller.abort();
            if (timer) window.clearInterval(timer);
        };
    }, [focusTask?.id, panelRefreshTick, selectedOrigin, selectedSection?.key]);

    useEffect(() => {
        if (selectedOrigin?.origin_type !== 'event' || !selectedOrigin?.origin_id) {
            setEventDetails(null);
            setEventDraft(null);
            setEventDraftBaseline('');
            setEventSaveError('');
            return undefined;
        }
        let cancelled = false;
        const controller = new AbortController();
        const loadEventEditor = async () => {
            try {
                const response = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(selectedOrigin.origin_id)}`, {
                    signal: controller.signal
                });
                if (!response.ok) throw new Error('Failed to load event details');
                const payload = await response.json();
                if (cancelled) return;
                const nextDraft = buildEventEditorDraft(payload);
                setEventDetails(payload);
                setEventDraft(nextDraft);
                setEventDraftBaseline(JSON.stringify(nextDraft));
                setEventSaveError('');
            } catch (loadError) {
                if (loadError?.name === 'AbortError' || cancelled) return;
                console.error('Failed to load todo event editor:', loadError);
                setEventDetails(null);
                setEventDraft(null);
            }
        };
        loadEventEditor();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [panelRefreshTick, selectedOrigin?.origin_id, selectedOrigin?.origin_type]);

    const handleEventDraftChange = (patch) => {
        setEventDraft((prev) => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    };

    const eventDraftDirty = useMemo(() => (
        eventDraft && eventDraftBaseline && JSON.stringify(eventDraft) !== eventDraftBaseline
    ), [eventDraft, eventDraftBaseline]);

    useEffect(() => {
        if (!focusTask?.id || !panelData?.autoProgress || loading || error) return;
        if (getTaskCycleState(focusTask) === 'done') return;
        ensureTaskInProgress(focusTask);
    }, [ensureTaskInProgress, error, focusTask, loading, panelData]);

    useEffect(() => {
        if (!focusTask?.id || !eventDraftDirty || selectedOrigin?.origin_type !== 'event') return;
        ensureTaskInProgress(focusTask);
    }, [ensureTaskInProgress, eventDraftDirty, focusTask, selectedOrigin?.origin_type]);

    const handleSaveEvent = async () => {
        if (!selectedOrigin?.origin_id || !eventDraft) return;
        setEventSaving(true);
        setEventSaveError('');
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(selectedOrigin.origin_id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: eventDraft.title,
                    description: eventDraft.description,
                    event_type_id: eventDraft.eventTypeId ? Number(eventDraft.eventTypeId) : null,
                    building_id: eventDraft.buildingId || '',
                    contact_person: eventDraft.contactPerson,
                    contact_email: eventDraft.contactEmail,
                    contact_phone: eventDraft.contactPhone,
                    contact_address: eventDraft.contactAddress,
                    internal_notes: eventDraft.internalNotes
                })
            });
            if (!response.ok) throw new Error('Failed to save event');
            await response.json();
            await Promise.allSettled([
                typeof reloadTasks === 'function' ? reloadTasks() : Promise.resolve(),
                typeof refreshEvents === 'function' ? refreshEvents() : Promise.resolve()
            ]);
            setPanelRefreshTick((prev) => prev + 1);
        } catch (saveError) {
            console.error('Failed to save event from todo panel:', saveError);
            setEventSaveError('Unable to save event changes.');
        } finally {
            setEventSaving(false);
        }
    };

    const handlePackageStatus = async (listKey, action) => {
        if (!selectedOrigin?.origin_id || !listKey) return;
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(selectedOrigin.origin_id)}/package-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    list_key: listKey,
                    action
                })
            });
            if (!response.ok) throw new Error('Failed to update future package status');
            await Promise.allSettled([
                typeof reloadTasks === 'function' ? reloadTasks() : Promise.resolve(),
                typeof refreshEvents === 'function' ? refreshEvents() : Promise.resolve()
            ]);
            setPanelRefreshTick((prev) => prev + 1);
        } catch (statusError) {
            console.error('Failed to update future package status:', statusError);
            setEventSaveError('Unable to update future package status.');
        }
    };

    return (
        <Card className={`tasks-detail-card ${selectedOrigin ? getOriginColorClass(selectedOrigin.origin_type) : ''}`}>
            <div className="tasks-list-header task-detail-header">
                <div>
                    <div className="task-detail-header-title">
                        <h2>{selectedOrigin ? selectedOriginTitle : 'Task Data'}</h2>
                        {selectedOrigin && originRoute ? <a className="btn-icon btn-icon-ghost origin-open-link" href={originRoute} aria-label="Open module" title="Open module"><FaExternalLinkAlt /></a> : null}
                    </div>
                    <p className="muted">{selectedOrigin ? selectedOriginSubtitle : 'Select a package to restore the task data panel.'}</p>
                </div>
            </div>
            {!selectedOrigin ? <div className="task-panel-empty">Select a package to show task-specific data.</div> : null}
            {selectedOrigin && selectedWorkPackage ? (
                <div className="task-detail-body task-data-body">
                    <div className="focus-section-rail task-data-section-rail">
                        {selectedWorkPackage.sections.map((section) => {
                            const Icon = getSectionIconComponent(section.iconKey);
                            const activeTask = section.actionTask || section.currentTask;
                            const chipText = getTaskCycleChipText(activeTask);
                            const chipState = getTaskCycleState(activeTask);
                            const isActive = selectedSectionKey === section.key;
                            return (
                                <button
                                    key={section.key}
                                    type="button"
                                    className={`focus-section-tab focus-section-tab-button attention-${section.attention} ${isActive ? 'is-active' : ''}`}
                                    onClick={() => {
                                        setSelectedSectionKey(section.key);
                                        setSelectedTaskId(activeTask?.id || '');
                                    }}
                                    title={activeTask ? `${section.title}: ${getTaskCycleLabel(activeTask)}` : section.title}
                                >
                                    <span className={`focus-section-tab-icon state-${section.status}`}>
                                        <Icon />
                                        {section.dueIndicator ? <span className={`section-due-chip is-${section.dueIndicator}`}>{section.dueIndicator === 'overdue' ? '!' : ''}</span> : null}
                                        {chipText ? <span className={`section-state-chip status-${chipState}`}>{chipText}</span> : null}
                                    </span>
                                    <span className="focus-section-tab-copy"><strong>{section.title}</strong></span>
                                </button>
                            );
                        })}
                    </div>
                    {focusTask ? <div className="task-panel-commandbar"><div className="task-panel-commandcopy"><strong>{selectedSection?.title || focusTask?.list_title || focusTask?.text || 'Task'}</strong><span>{getTaskCycleLabel(focusTask)}</span></div><div className="task-panel-commandactions"><button type="button" className={`btn-compact task-panel-complete-btn ${getTaskCycleState(focusTask) === 'done' ? 'is-done' : 'is-open'}`} onClick={() => markTaskDone(focusTask)} disabled={getTaskCycleState(focusTask) === 'done'}>{getTaskCycleState(focusTask) === 'done' ? <FaCheck /> : null}{getTaskCycleState(focusTask) === 'done' ? 'Completed' : 'Mark Complete'}</button><button type="button" className="btn-secondary btn-compact" onClick={() => resetTaskState(focusTask)} title="Reset task status"><FaRedoAlt /></button></div></div> : null}
                    {loading ? <div className="task-panel-empty">Loading task data...</div> : null}
                    {error && !loading ? <div className="task-panel-empty">{error}</div> : null}
                    {!loading && !error ? renderPanelContent({
                        panelData,
                        selectedSectionKey,
                        originRoute,
                        eventEditorProps: {
                            details: eventDetails,
                            draft: eventDraft,
                            saving: eventSaving,
                            saveError: eventSaveError,
                            onDraftChange: handleEventDraftChange,
                            onSave: handleSaveEvent,
                            onPackageStatus: handlePackageStatus
                        },
                        ordersPanelProps: {
                            onRefresh: () => setPanelRefreshTick((prev) => prev + 1),
                            onActivity: () => {
                                if (focusTask) ensureTaskInProgress(focusTask);
                            }
                        }
                    }) : null}
                </div>
            ) : null}
        </Card>
    );
};

export default TodoDetailPanel;
