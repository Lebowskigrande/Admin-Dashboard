import { NavLink } from 'react-router-dom';
import { FaHome, FaCalendarAlt, FaMoneyBillWave, FaList, FaBuilding, FaUsers, FaCog, FaClipboardCheck, FaSun, FaChurch, FaProjectDiagram } from 'react-icons/fa';
import logo from '../assets/logo.png';
import './Sidebar.css';

const Sidebar = () => {
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
        { path: '/settings', label: 'Settings', icon: <FaCog /> },
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
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
