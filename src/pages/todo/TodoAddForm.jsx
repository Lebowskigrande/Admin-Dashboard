import { FaPlus } from 'react-icons/fa';

const TodoAddForm = ({
    projectName,
    newTask,
    newTaskDuePreset,
    onProjectChange,
    onTaskChange,
    onDuePresetChange,
    onSubmit,
    onSubmitWithDetails,
    showCompleted,
    onToggleCompleted
}) => (
    <>
        <form className="task-add-form task-add-form--header" onSubmit={onSubmit}>
            <input
                type="text"
                className="task-project-input"
                placeholder="Project"
                value={projectName}
                onChange={onProjectChange}
            />
            <input
                type="text"
                placeholder="Quick add a task..."
                value={newTask}
                onChange={onTaskChange}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    if (!event.shiftKey) return;
                    event.preventDefault();
                    onSubmitWithDetails();
                }}
            />
            <select
                className="task-due-select"
                value={newTaskDuePreset}
                onChange={onDuePresetChange}
                aria-label="Quick due date preset"
            >
                <option value="">No due</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="friday">This Friday</option>
                <option value="next-monday">Next Monday</option>
            </select>
            <button type="submit" className="btn-primary" disabled={!newTask.trim()}>
                <FaPlus /> Add
            </button>
        </form>
        <span className="task-add-hint">Enter: quick add · Shift+Enter: add + details</span>
        <label className="toggle-inline">
            <input
                type="checkbox"
                checked={showCompleted}
                onChange={onToggleCompleted}
            />
            Show completed
        </label>
    </>
);

export default TodoAddForm;
