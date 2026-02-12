import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import Modal from '../components/Modal';
import TodoAddForm from './todo/TodoAddForm';
import TodoListCard from './todo/TodoListCard';
import TodoDetailPanel from './todo/TodoDetailPanel';
import { useTodoData } from './todo/useTodoData';
import './Todo.css';

const Todo = () => {
    const navigate = useNavigate();
    const {
        PRIORITY_OPTIONS,
        tasksLoading,
        error,
        newTask,
        projectName,
        showCompleted,
        taskModalOpen,
        taskDraft,
        taskNotesDraft,
        selectedOriginKey,
        selectedTaskId,
        selectedTaskKey,
        selectedOrigin,
        selectedOriginTitle,
        selectedOriginSubtitle,
        selectedTask,
        originLinks,
        nestedExpanded,
        nestedTasks,
        nestedLoading,
        originGroupMap,
        weekBuckets,
        setProjectName,
        setNewTask,
        setShowCompleted,
        setTaskModalOpen,
        setTaskDraft,
        setTaskNotesDraft,
        setSelectedOriginKey,
        setSelectedTaskId,
        addTask,
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
        sortTasksForDetails,
        formatTaskTitle,
        handleToggleNested
    } = useTodoData();

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

    return (
        <div className="page-todo">
            <header className="page-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Tasks</h1>
                    <p className="page-header-subtitle">Due this week first, then next week and later.</p>
                </div>
                <div className="page-header-actions">
                    <TodoAddForm
                        projectName={projectName}
                        newTask={newTask}
                        onProjectChange={(event) => setProjectName(event.target.value)}
                        onTaskChange={(event) => setNewTask(event.target.value)}
                        onSubmit={addTask}
                        showCompleted={showCompleted}
                        onToggleCompleted={(event) => setShowCompleted(event.target.checked)}
                    />
                </div>
            </header>

            <div className="tasks-layout">
                <div className="tasks-stack">
                    <TodoListCard
                        title="This Week"
                        subtitle={`Due ${format(weekBuckets.weekStart, 'MMM d')} - ${format(weekBuckets.weekEnd, 'MMM d')}`}
                        rows={weekBuckets.thisWeek}
                        tasksLoading={tasksLoading}
                        error={error}
                        emptyLabel="This week's tasks complete."
                        countLabel={`${weekBuckets.thisWeek.length} tasks`}
                        renderCountBadge={renderCountBadge}
                        useWrapper
                        selectedOriginKey={selectedOriginKey}
                        selectedTaskId={selectedTaskId}
                        onSelectRow={(originKey, taskId) => {
                            setSelectedOriginKey(originKey);
                            setSelectedTaskId(taskId);
                        }}
                        formatOriginLabel={formatOriginLabel}
                        formatOriginSubtitle={formatOriginSubtitle}
                        getTopLevelTaskTitle={getTopLevelTaskTitle}
                        getTaskProgressMeta={getTaskProgressMeta}
                        getTaskNextStepLabel={getTaskNextStepLabel}
                        getOriginColorClass={getOriginColorClass}
                        getDisplayClass={getDisplayClass}
                        getDisplayLabel={getDisplayLabel}
                        toggleTask={toggleTask}
                    />

                    <TodoListCard
                        title="Next Week"
                        subtitle={`${format(weekBuckets.nextWeekStart, 'MMM d')} - ${format(weekBuckets.nextWeekEnd, 'MMM d')}`}
                        rows={weekBuckets.nextWeek}
                        tasksLoading={tasksLoading}
                        error={error}
                        emptyLabel="Next week's tasks complete."
                        countLabel={`${weekBuckets.nextWeek.length} tasks`}
                        renderCountBadge={renderCountBadge}
                        selectedOriginKey={selectedOriginKey}
                        selectedTaskId={selectedTaskId}
                        onSelectRow={(originKey, taskId) => {
                            setSelectedOriginKey(originKey);
                            setSelectedTaskId(taskId);
                        }}
                        formatOriginLabel={formatOriginLabel}
                        formatOriginSubtitle={formatOriginSubtitle}
                        getTopLevelTaskTitle={getTopLevelTaskTitle}
                        getTaskProgressMeta={getTaskProgressMeta}
                        getTaskNextStepLabel={getTaskNextStepLabel}
                        getOriginColorClass={getOriginColorClass}
                        getDisplayClass={getDisplayClass}
                        getDisplayLabel={getDisplayLabel}
                        toggleTask={toggleTask}
                    />

                    <TodoListCard
                        title="Later"
                        subtitle="Beyond next week"
                        rows={weekBuckets.later}
                        tasksLoading={tasksLoading}
                        error={error}
                        emptyLabel="Later tasks complete."
                        countLabel={`${weekBuckets.later.length} tasks`}
                        renderCountBadge={renderCountBadge}
                        selectedOriginKey={selectedOriginKey}
                        selectedTaskId={selectedTaskId}
                        onSelectRow={(originKey, taskId) => {
                            setSelectedOriginKey(originKey);
                            setSelectedTaskId(taskId);
                        }}
                        formatOriginLabel={formatOriginLabel}
                        formatOriginSubtitle={formatOriginSubtitle}
                        getTopLevelTaskTitle={getTopLevelTaskTitle}
                        getTaskProgressMeta={getTaskProgressMeta}
                        getTaskNextStepLabel={getTaskNextStepLabel}
                        getOriginColorClass={getOriginColorClass}
                        getDisplayClass={getDisplayClass}
                        getDisplayLabel={getDisplayLabel}
                        toggleTask={toggleTask}
                    />
                </div>

                <TodoDetailPanel
                    selectedOrigin={selectedOrigin}
                    selectedOriginTitle={selectedOriginTitle}
                    selectedOriginSubtitle={selectedOriginSubtitle}
                    selectedTaskKey={selectedTaskKey}
                    selectedTask={selectedTask}
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
                    setSelectedTaskId={setSelectedTaskId}
                    formatOriginSubtitle={formatOriginSubtitle}
                    formatTaskTitle={formatTaskTitle}
                    getDisplayClass={getDisplayClass}
                    getDisplayLabel={getDisplayLabel}
                    getListProgressDisplay={getListProgressDisplay}
                    getTopLevelTaskTitle={getTopLevelTaskTitle}
                    getListRepresentativeTask={getListRepresentativeTask}
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
