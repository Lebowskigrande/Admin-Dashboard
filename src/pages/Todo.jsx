import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import Modal from '../components/Modal';
import TodoAddForm from './todo/TodoAddForm';
import TodoListCard from './todo/TodoListCard';
import TodoDetailPanel from './todo/TodoDetailPanel';
import { useTodoData } from './todo/useTodoData';
import { getDueInfo } from './todo/todoHelpers';
import './Todo.css';

const Todo = () => {
    const navigate = useNavigate();
    const {
        PRIORITY_OPTIONS,
        tasksLoading,
        error,
        taskList,
        newTask,
        newTaskDuePreset,
        projectName,
        showCompleted,
        taskModalOpen,
        taskDraft,
        taskNotesDraft,
        selectedOriginKey,
        selectedSectionKey,
        selectedTaskId,
        selectedTaskKey,
        selectedOrigin,
        selectedWorkPackage,
        selectedSection,
        selectedOriginTitle,
        selectedOriginSubtitle,
        selectedTask,
        focusTask,
        originLinks,
        nestedExpanded,
        nestedTasks,
        nestedLoading,
        originGroupMap,
        weekBuckets,
        setProjectName,
        setNewTask,
        setNewTaskDuePreset,
        setShowCompleted,
        setTaskModalOpen,
        setTaskDraft,
        setTaskNotesDraft,
        setSelectedOriginKey,
        setSelectedSectionKey,
        setSelectedTaskId,
        addTask,
        addTaskWithDetails,
        saveTaskDetails,
        saveTaskNotes,
        updateTaskProgress,
        toggleTask,
        getDisplayClass,
        getDisplayLabel,
        getOriginLink,
        getOriginColorClass,
        formatOriginLabel,
        formatOriginSubtitle,
        getTopLevelTaskTitle,
        getTaskNextStepLabel,
        getTaskProgressMeta,
        getListRepresentativeTask,
        getListProgressDisplay,
        getListChecklist,
        getWorkPackageTitle,
        getWorkPackageSubtitle,
        getWorkPackageSummary,
        sortTasksForDetails,
        formatTaskTitle,
        handleToggleNested
    } = useTodoData();
    const [urgencyFilter, setUrgencyFilter] = useState('all');

    const renderCountBadge = useCallback((count, label) => (
        count === 0 ? (
            <span className="check-badge count-badge-check" aria-label={label}>
                &#10003;
            </span>
        ) : (
            <span className="count-badge" aria-label={label}>
                {count}
            </span>
        )
    ), []);

    const unifiedRows = useMemo(() => {
        const rowWithBucket = (row, bucket) => ({ ...row, bucket });
        return [
            ...weekBuckets.thisWeek.map((row) => rowWithBucket(row, 'this_week')),
            ...weekBuckets.nextWeek.map((row) => rowWithBucket(row, 'next_week')),
            ...weekBuckets.later.map((row) => rowWithBucket(row, 'later'))
        ];
    }, [weekBuckets]);

    const filteredRows = useMemo(() => {
        if (urgencyFilter === 'all') return unifiedRows;
        if (urgencyFilter === 'this_week') return unifiedRows.filter((row) => row.bucket === 'this_week');
        if (urgencyFilter === 'next_week') return unifiedRows.filter((row) => row.bucket === 'next_week');
        if (urgencyFilter === 'later') return unifiedRows.filter((row) => row.bucket === 'later');
        if (urgencyFilter === 'overdue') {
            return unifiedRows.filter((row) => getDueInfo(row.task)?.rank === 0);
        }
        if (urgencyFilter === 'today') {
            return unifiedRows.filter((row) => getDueInfo(row.task)?.rank === 1);
        }
        return unifiedRows;
    }, [unifiedRows, urgencyFilter]);

    const dashboardCounts = useMemo(() => {
        const overdue = unifiedRows.filter((row) => getDueInfo(row.task)?.rank === 0).length;
        const today = unifiedRows.filter((row) => getDueInfo(row.task)?.rank === 1).length;
        const open = unifiedRows.length;
        const doneThisWeek = taskList.filter((task) => {
            if (!task?.completed_at) return false;
            const completedAt = new Date(task.completed_at);
            if (Number.isNaN(completedAt.getTime())) return false;
            return completedAt >= weekBuckets.weekStart && completedAt <= weekBuckets.weekEnd;
        }).length;
        return { open, overdue, today, doneThisWeek };
    }, [taskList, unifiedRows, weekBuckets.weekEnd, weekBuckets.weekStart]);

    return (
        <div className="page-todo">
            <header className="page-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Tasks</h1>
                    <p className="page-header-subtitle">Visual workboard for services, events, meetings, and ops packages with section-level focus instead of text-heavy task scanning.</p>
                </div>
                <div className="page-header-actions">
                    <TodoAddForm
                        projectName={projectName}
                        newTask={newTask}
                        newTaskDuePreset={newTaskDuePreset}
                        onProjectChange={(event) => setProjectName(event.target.value)}
                        onTaskChange={(event) => setNewTask(event.target.value)}
                        onDuePresetChange={(event) => setNewTaskDuePreset(event.target.value)}
                        onSubmit={addTask}
                        onSubmitWithDetails={addTaskWithDetails}
                        showCompleted={showCompleted}
                        onToggleCompleted={(event) => setShowCompleted(event.target.checked)}
                    />
                </div>
            </header>
            <div className="todo-kpi-strip">
                <div className="todo-kpi-card">
                    <span className="todo-kpi-label">Open Packages</span>
                    <strong className="todo-kpi-value">{dashboardCounts.open}</strong>
                </div>
                <div className="todo-kpi-card">
                    <span className="todo-kpi-label">Overdue</span>
                    <strong className="todo-kpi-value">{dashboardCounts.overdue}</strong>
                </div>
                <div className="todo-kpi-card">
                    <span className="todo-kpi-label">Due Today</span>
                    <strong className="todo-kpi-value">{dashboardCounts.today}</strong>
                </div>
                <div className="todo-kpi-card">
                    <span className="todo-kpi-label">Done This Week</span>
                    <strong className="todo-kpi-value">{dashboardCounts.doneThisWeek}</strong>
                </div>
            </div>
            <div className="todo-filter-chips">
                {[
                    { key: 'all', label: 'All' },
                    { key: 'overdue', label: 'Overdue' },
                    { key: 'today', label: 'Today' },
                    { key: 'this_week', label: 'This Week' },
                    { key: 'next_week', label: 'Next Week' },
                    { key: 'later', label: 'Later' }
                ].map((filter) => (
                    <button
                        key={filter.key}
                        type="button"
                        className={`todo-chip ${urgencyFilter === filter.key ? 'active' : ''}`}
                        onClick={() => setUrgencyFilter(filter.key)}
                    >
                        {filter.label}
                    </button>
                ))}
            </div>

            <div className="tasks-layout">
                <div className="tasks-stack">
                    <TodoListCard
                        title="Work Queue"
                        subtitle={`Week of ${format(weekBuckets.weekStart, 'MMM d')} - ${format(weekBuckets.weekEnd, 'MMM d')}`}
                        rows={filteredRows}
                        tasksLoading={tasksLoading}
                        error={error}
                        emptyLabel="No work packages in this filter."
                        countLabel={`${filteredRows.length} packages`}
                        renderCountBadge={renderCountBadge}
                        useWrapper
                        selectedOriginKey={selectedOriginKey}
                        selectedSectionKey={selectedSectionKey}
                        onSelectRow={(originKey, sectionKey, taskId) => {
                            setSelectedOriginKey(originKey);
                            setSelectedSectionKey(sectionKey || '');
                            setSelectedTaskId(taskId);
                        }}
                        formatOriginLabel={formatOriginLabel}
                        getWorkPackageTitle={getWorkPackageTitle}
                        getWorkPackageSubtitle={getWorkPackageSubtitle}
                        getWorkPackageSummary={getWorkPackageSummary}
                        getOriginColorClass={getOriginColorClass}
                        getDisplayClass={getDisplayClass}
                        getDisplayLabel={getDisplayLabel}
                        toggleTask={toggleTask}
                    />
                </div>

                <TodoDetailPanel
                    selectedOrigin={selectedOrigin}
                    selectedWorkPackage={selectedWorkPackage}
                    selectedSection={selectedSection}
                    selectedOriginTitle={selectedOriginTitle}
                    selectedOriginSubtitle={selectedOriginSubtitle}
                    selectedSectionKey={selectedSectionKey}
                    selectedTaskKey={selectedTaskKey}
                    selectedTask={focusTask || selectedTask}
                    taskNotesDraft={taskNotesDraft}
                    setTaskNotesDraft={setTaskNotesDraft}
                    saveTaskNotes={saveTaskNotes}
                    updateTaskProgress={updateTaskProgress}
                    toggleTask={toggleTask}
                    originLinks={originLinks}
                    nestedExpanded={nestedExpanded}
                    nestedTasks={nestedTasks}
                    nestedLoading={nestedLoading}
                    originGroupMap={originGroupMap}
                    handleToggleNested={handleToggleNested}
                    setSelectedOriginKey={setSelectedOriginKey}
                    setSelectedSectionKey={setSelectedSectionKey}
                    setSelectedTaskId={setSelectedTaskId}
                    formatTaskTitle={formatTaskTitle}
                    getDisplayClass={getDisplayClass}
                    getDisplayLabel={getDisplayLabel}
                    sortTasksForDetails={sortTasksForDetails}
                    getTaskProgressMeta={getTaskProgressMeta}
                    getOriginColorClass={getOriginColorClass}
                    getOriginLink={getOriginLink}
                    onOpenOrigin={(link) => navigate(link)}
                />
            </div>

            <Modal
                isOpen={taskModalOpen}
                onClose={() => setTaskModalOpen(false)}
                title="Add Task Details"
            >
                <div className="task-detail-modal">
                    <div className="form-group">
                        <label>Task</label>
                        <input
                            type="text"
                            value={taskDraft.text}
                            onChange={(e) => setTaskDraft((prev) => ({ ...prev, text: e.target.value }))}
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Due date</label>
                            <input
                                type="date"
                                value={taskDraft.dueDate}
                                onChange={(e) => setTaskDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                            />
                        </div>
                        <div className="form-group">
                            <label>Priority</label>
                            <select
                                value={taskDraft.priorityOverride}
                                onChange={(e) => setTaskDraft((prev) => ({ ...prev, priorityOverride: e.target.value }))}
                            >
                                <option value="">Use default</option>
                                {PRIORITY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            rows={4}
                            value={taskDraft.notes}
                            onChange={(e) => setTaskDraft((prev) => ({ ...prev, notes: e.target.value }))}
                            placeholder="Add any reminders or context."
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setTaskModalOpen(false)}>
                            Not now
                        </button>
                        <button type="button" className="btn-primary" onClick={saveTaskDetails} disabled={!taskDraft.text.trim()}>
                            Save Details
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Todo;
