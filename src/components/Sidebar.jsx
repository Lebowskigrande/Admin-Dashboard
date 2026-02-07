import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { FaHome, FaCalendarAlt, FaMoneyBillWave, FaList, FaBuilding, FaUsers, FaCog, FaClipboardCheck, FaSun, FaChurch, FaProjectDiagram, FaSyncAlt } from 'react-icons/fa';
import logo from '../assets/logo.png';
import { API_URL } from '../services/apiConfig';
import './Sidebar.css';

const Sidebar = () => {
    const [restarting, setRestarting] = useState(false);
    const navItems = [
        { path: '/', label: 'Overview', icon: <FaHome /> },
        { path: '/sunday', label: 'Sunday Planner', icon: <FaSun /> },
        { path: '/calendar', label: 'Events Calendar', icon: <FaCalendarAlt /> },
        { path: '/liturgical-schedule', label: 'Liturgical Schedule', icon: <FaClipboardCheck /> },
        { path: '/finance', label: 'Finance', icon: <FaMoneyBillWave /> },
        { path: '/vestry', label: 'Vestry', icon: <FaChurch /> },
        { path: '/buildings', label: 'Buildings & Grounds', icon: <FaBuilding /> },
        { path: '/people', label: 'People', icon: <FaUsers /> },
        { path: '/todo', label: 'To-Do List', icon: <FaList /> },
        { path: '/task-origins', label: 'Task Origins', icon: <FaProjectDiagram /> },
        { path: '/event-templates', label: 'Event Templates', icon: <FaProjectDiagram /> },
        { path: '/settings', label: 'Settings', icon: <FaCog /> },
    ];

    const handleRestart = async () => {
        if (restarting) return;
        setRestarting(true);
        try {
            const response = await fetch(`${API_URL}/dev/restart`, { method: 'POST' });
            if (!response.ok) throw new Error('Restart failed');
            window.setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (error) {
            console.error(error);
            setRestarting(false);
        } finally {
            window.setTimeout(() => {
                setRestarting(false);
            }, 10000);
        }
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <button
                    type="button"
                    className="sidebar-refresh"
                    onClick={handleRestart}
                    disabled={restarting}
                    title={restarting ? 'Restarting services...' : 'Restart server + client'}
                >
                    <FaSyncAlt className={restarting ? 'spin' : ''} />
                </button>
                <img src={logo} alt="St. Edmund's Logo" className="sidebar-logo" />
                <div className="sidebar-title">
                    <h2>St. Edmund's</h2>
                    <span>Episcopal Parish</span>
                </div>
            </div>
            <nav className="sidebar-nav">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
                    >
                        <span className="icon">{item.icon}</span>
                        <span className="label">{item.label}</span>
                    </NavLink>
                ))}
            </nav>

        </aside>
    );
};

export default Sidebar;
