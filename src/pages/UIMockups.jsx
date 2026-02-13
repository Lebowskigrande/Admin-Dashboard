import './UIMockups.css';

const sampleToday = [
    { time: '8:30 AM', title: 'Morning Prayer Setup' },
    { time: '11:00 AM', title: 'Choir Coordination Call' },
    { time: '2:00 PM', title: 'Bulletin Proof Review' }
];

const sampleTasks = [
    { title: 'Confirm Sunday ushers', priority: 'High' },
    { title: 'Finalize vestry packet', priority: 'Critical' },
    { title: 'Approve landscaping invoice', priority: 'Normal' }
];

const sampleNow = ['Sanctuary prep', 'Calendar cleanup', 'Volunteer follow-ups'];

const UIMockups = () => {
    return (
        <div className="ui-mockups-page">
            <header className="ui-mockups-header">
                <p className="ui-mockups-kicker">Concept Deck</p>
                <h1>Dashboard UI Update Mockups</h1>
                <p className="ui-mockups-subtitle">
                    Two evolutionary updates and one radical direction for a sharper weekly operations view.
                </p>
            </header>

            <section className="ui-mockups-grid" aria-label="Dashboard mockups">
                <article className="mockup-card mockup-card-a">
                    <div className="mockup-meta">
                        <h2>Mockup A: Refined Classic</h2>
                        <span className="mockup-tag minor">Minor Tweaks</span>
                    </div>
                    <p className="mockup-note">
                        Keeps your current information architecture, improves hierarchy with stronger section rails, clearer chips, and calmer spacing.
                    </p>
                    <div className="mockup-canvas canvas-a">
                        <div className="canvas-a-header">
                            <div>
                                <h3>Dashboard Overview</h3>
                                <p>Friday plan with weather and top priorities</p>
                            </div>
                            <span className="canvas-date">Fri, Feb 13</span>
                        </div>
                        <div className="canvas-a-content">
                            <div className="module">
                                <h4>Today</h4>
                                <ul>
                                    {sampleToday.map((item) => (
                                        <li key={item.title}>
                                            <span>{item.time}</span>
                                            <strong>{item.title}</strong>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="module">
                                <h4>Task Queue</h4>
                                <ul>
                                    {sampleTasks.map((task) => (
                                        <li key={task.title}>
                                            <strong>{task.title}</strong>
                                            <span className="mini-chip">{task.priority}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </article>

                <article className="mockup-card mockup-card-b">
                    <div className="mockup-meta">
                        <h2>Mockup B: Dense Workbench</h2>
                        <span className="mockup-tag minor">Minor Tweaks</span>
                    </div>
                    <p className="mockup-note">
                        A tighter operational console: quick command bar, sortable lanes, and stronger at-a-glance capacity indicators.
                    </p>
                    <div className="mockup-canvas canvas-b">
                        <div className="canvas-b-toolbar">
                            <div className="fake-search">Search tasks, people, events...</div>
                            <div className="dot-group">
                                <span />
                                <span />
                                <span />
                            </div>
                        </div>
                        <div className="canvas-b-board">
                            <div className="lane">
                                <h4>Doing Now</h4>
                                {sampleNow.map((item) => (
                                    <div key={item} className="ticket">{item}</div>
                                ))}
                            </div>
                            <div className="lane">
                                <h4>Upcoming</h4>
                                <div className="ticket">Sunday checklist lock</div>
                                <div className="ticket">Email liturgical team</div>
                                <div className="ticket">Confirm HVAC vendor</div>
                            </div>
                            <div className="lane">
                                <h4>Waiting</h4>
                                <div className="ticket muted">Treasurer sign-off</div>
                                <div className="ticket muted">Printer ETA</div>
                            </div>
                        </div>
                    </div>
                </article>

                <article className="mockup-card mockup-card-c">
                    <div className="mockup-meta">
                        <h2>Mockup C: Mission Control</h2>
                        <span className="mockup-tag radical">Radical Departure</span>
                    </div>
                    <p className="mockup-note">
                        Reimagines the dashboard as a command center with a visual timeline spine, live urgency pulses, and focus mode panels.
                    </p>
                    <div className="mockup-canvas canvas-c">
                        <div className="canvas-c-main">
                            <h3>Today&apos;s Operational Pulse</h3>
                            <p>7 active streams, 2 blockers, weather stable</p>
                            <div className="pulse-line">
                                <span>06:00</span>
                                <span>09:30</span>
                                <span>12:00</span>
                                <span>16:45</span>
                                <span>19:00</span>
                            </div>
                        </div>
                        <div className="canvas-c-rings" aria-hidden="true">
                            <div className="ring ring-a" />
                            <div className="ring ring-b" />
                            <div className="ring ring-c" />
                        </div>
                        <div className="canvas-c-stack">
                            <div className="focus-card">
                                <small>Critical Track</small>
                                <strong>Vestry packet signatures</strong>
                            </div>
                            <div className="focus-card">
                                <small>Live Ops</small>
                                <strong>Sunday setup 62% complete</strong>
                            </div>
                            <div className="focus-card">
                                <small>Forecast</small>
                                <strong>72F clear, no disruption risk</strong>
                            </div>
                        </div>
                    </div>
                </article>
            </section>
        </div>
    );
};

export default UIMockups;
