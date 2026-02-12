import { FaPlus } from 'react-icons/fa';

const TodoAddForm = ({
    projectName,
    newTask,
    onProjectChange,
    onTaskChange,
    onSubmit,
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
            />
            <button type="submit" className="btn-primary" disabled={!newTask.trim()}>
                <FaPlus /> Add
            </button>
        </form>
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
