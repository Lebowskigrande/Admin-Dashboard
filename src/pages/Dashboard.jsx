import Card from '../components/Card';
import { FaCalendarCheck, FaClipboardList, FaMoneyBillAlt, FaTasks } from 'react-icons/fa';
import './Dashboard.css';

const Dashboard = () => {
    return (
        <div className="page-dashboard">
            <header className="dashboard-header">
                <div>
                    <h1>Dashboard Overview</h1>
                    <p className="welcome-text">Welcome back, Administrator. Here's what's happening today.</p>
                </div>
                <div className="date-display">
                    {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </header>

            <div className="dashboard-stats">
                <div className="stat-card">
                    <div className="stat-icon icon-events"><FaCalendarCheck /></div>
                    <div className="stat-info">
                        <span className="stat-value">3</span>
                        <span className="stat-label">Upcoming Events</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon icon-tasks"><FaTasks /></div>
                    <div className="stat-info">
                        <span className="stat-value">5</span>
                        <span className="stat-label">Pending Tasks</span>
                    </div>
                </div>
            </div>

            <div className="dashboard-grid">
                <Card title="Upcoming Events" className="dashboard-card">
                    <ul className="event-list">
                        <li>
                            <span className="event-date">Dec 24</span>
                            <span className="event-title">Christmas Eve Service</span>
                        </li>
                        <li>
                            <span className="event-date">Dec 25</span>
                            <span className="event-title">Christmas Day Service</span>
                        </li>
                    </ul>
                </Card>

                <Card title="Bulletin Status" className="dashboard-card">
                    <div className="status-indicator status-draft">
                        <span className="indicator-dot"></span>
                        <span className="indicator-text">Drafting in Progress</span>
                    </div>
                    <p className="status-detail">For Sunday, Dec 21st</p>
                </Card>

                <Card title="Finance Snapshot" className="dashboard-card">
                    <div className="finance-row">
                        <span>Collections (Dec)</span>
                        <span className="amount positive">+$12,450.00</span>
                    </div>
                    <div className="finance-row">
                        <span>Expenses (Dec)</span>
                        <span className="amount negative">-$4,200.00</span>
                    </div>
                </Card>

                <Card title="Quick Tasks" className="dashboard-card">
                    <ul className="task-list">
                        <li className="task-item">
                            <input type="checkbox" id="t1" />
                            <label htmlFor="t1">Print Bulletins</label>
                        </li>
                        <li className="task-item">
                            <input type="checkbox" id="t2" />
                            <label htmlFor="t2">Email Choir Director</label>
                        </li>
                    </ul>
                </Card>
            </div>
        </div>
    );
};

export default Dashboard;
