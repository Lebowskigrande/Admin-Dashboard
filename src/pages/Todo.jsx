import { useState } from 'react';
import { FaPlus, FaTrash, FaCheck } from 'react-icons/fa';
import Card from '../components/Card';
import './Todo.css';

const Todo = () => {
    const [tasks, setTasks] = useState([
        { id: 1, text: 'Print Sunday Bulletins', completed: false },
        { id: 2, text: 'Email Choir Director', completed: true },
        { id: 3, text: 'Review Building Fund Report', completed: false },
    ]);

    const [newTask, setNewTask] = useState('');
    const [filter, setFilter] = useState('all'); // all, active, completed

    const addTask = (e) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        setTasks([...tasks, { id: Date.now(), text: newTask, completed: false }]);
        setNewTask('');
    };

    const toggleTask = (id) => {
        setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
    };

    const deleteTask = (id) => {
        setTasks(tasks.filter(t => t.id !== id));
    };

    const filteredTasks = tasks.filter(t => {
        if (filter === 'active') return !t.completed;
        if (filter === 'completed') return t.completed;
        return true;
    });

    return (
        <div className="page-todo">
            <header className="page-header-controls">
                <h1>To-Do List</h1>
                <div className="task-filters">
                    <button
                        className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                        onClick={() => setFilter('all')}
                    >
                        All
                    </button>
                    <button
                        className={`filter-btn ${filter === 'active' ? 'active' : ''}`}
                        onClick={() => setFilter('active')}
                    >
                        Active
                    </button>
                    <button
                        className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
                        onClick={() => setFilter('completed')}
                    >
                        Completed
                    </button>
                </div>
            </header>

            <div className="todo-container">
                <Card className="todo-card">
                    <form className="add-task-form" onSubmit={addTask}>
                        <input
                            type="text"
                            placeholder="Add a new task..."
                            value={newTask}
                            onChange={(e) => setNewTask(e.target.value)}
                        />
                        <button type="submit" className="btn-primary" disabled={!newTask.trim()}>
                            <FaPlus /> Add
                        </button>
                    </form>

                    <ul className="task-list-full">
                        {filteredTasks.length === 0 && (
                            <li className="empty-state">No tasks found.</li>
                        )}
                        {filteredTasks.map(task => (
                            <li key={task.id} className={`task-item-full ${task.completed ? 'completed' : ''}`}>
                                <div className="checkbox-wrapper" onClick={() => toggleTask(task.id)}>
                                    <div className="custom-checkbox">
                                        {task.completed && <FaCheck />}
                                    </div>
                                </div>
                                <span className="task-text" onClick={() => toggleTask(task.id)}>{task.text}</span>
                                <button className="btn-delete" onClick={() => deleteTask(task.id)}>
                                    <FaTrash />
                                </button>
                            </li>
                        ))}
                    </ul>

                    <div className="todo-footer">
                        <span>{tasks.filter(t => !t.completed).length} items left</span>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default Todo;
