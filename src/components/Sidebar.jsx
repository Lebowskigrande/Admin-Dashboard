import { NavLink } from 'react-router-dom';
import { FaHome, FaCalendarAlt, FaMoneyBillWave, FaList, FaBuilding, FaUsers, FaEnvelope, FaMusic } from 'react-icons/fa';
import logo from '../assets/logo.png';
import './Sidebar.css';

const Sidebar = () => {
    const navItems = [
        { path: '/', label: 'Overview', icon: <FaHome /> },
        { path: '/calendar', label: 'Events Calendar', icon: <FaCalendarAlt /> },
        { path: '/finance', label: 'Finance', icon: <FaMoneyBillWave /> },
        { path: '/communications', label: 'Communications', icon: <FaEnvelope /> },
        { path: '/buildings', label: 'Buildings & Ops', icon: <FaBuilding /> },
        { path: '/people', label: 'People & Ministry', icon: <FaUsers /> },
        { path: '/music', label: 'Music', icon: <FaMusic /> },
        { path: '/todo', label: 'To-Do List', icon: <FaList /> },
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
            <div className="sidebar-footer">
                <p>© 2025 Church Admin</p>
            </div>
        </aside>
    );
};

export default Sidebar;
