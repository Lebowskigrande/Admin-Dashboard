import { useEffect, useState } from 'react';
import { FaPlus, FaTrash, FaCheck } from 'react-icons/fa';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import './Todo.css';

const Todo = () => {
    const [tasks, setTasks] = useState([]);
    const [newTask, setNewTask] = useState('');
    const [filter, setFilter] = useState('all'); // all, active, completed
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const loadTasks = async () => {
            setLoading(true);
            setError('');
            try {
                const response = await fetch(`${API_URL}/tasks`);
                if (!response.ok) throw new Error('Failed to load tasks');
                const data = await response.json();
                setTasks(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Failed to load tasks:', err);
                setError('Unable to load tasks. Please refresh and try again.');
            } finally {
                setLoading(false);
            }
        };

        loadTasks();
    }, []);

    const addTask = async (e) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: newTask.trim() })
            });
            if (!response.ok) throw new Error('Failed to create task');
            const created = await response.json();
            setTasks((prev) => [created, ...prev]);
            setNewTask('');
        } catch (err) {
            console.error('Failed to create task:', err);
            setError('Unable to add task. Please try again.');
        }
    };

    const toggleTask = async (id) => {
        const task = tasks.find((item) => item.id === id);
        if (!task) return;
        try {
            const response = await fetch(`${API_URL}/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: task.text, completed: !task.completed })
            });
            if (!response.ok) throw new Error('Failed to update task');
            const updated = await response.json();
            setTasks((prev) => prev.map((item) => (item.id === id ? updated : item)));
        } catch (err) {
            console.error('Failed to update task:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const deleteTask = async (id) => {
        try {
            const response = await fetch(`${API_URL}/tasks/${id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete task');
            setTasks((prev) => prev.filter((item) => item.id !== id));
        } catch (err) {
            console.error('Failed to delete task:', err);
            setError('Unable to delete task. Please try again.');
        }
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
                        {loading && (
                            <li className="empty-state">Loading tasks...</li>
                        )}
                        {error && (
                            <li className="empty-state">{error}</li>
                        )}
                        {!loading && !error && filteredTasks.length === 0 && (
                            <li className="empty-state">No tasks found.</li>
                        )}
                        {filteredTasks.map(task => (
                            <li key={task.id} className={`task-item-full ${task.completed ? 'completed' : ''}`}>
                                <div className="checkbox-wrapper" onClick={() => toggleTask(task.id)}>
                                    <div className="custom-checkbox">
                                        {task.completed && <FaCheck />}
                                    </div>
                                </div>
                                <div className="task-content">
                                    <span className="task-text" onClick={() => toggleTask(task.id)}>{task.text}</span>
                                    {task.ticket_title && (
                                        <span className="task-meta">Ticket: {task.ticket_title}</span>
                                    )}
                                </div>
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
