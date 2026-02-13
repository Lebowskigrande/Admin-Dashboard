import Card from '../../components/Card';

const STATUS_OPTIONS = [
    { value: 'not_started', label: 'Not Started' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'ready', label: 'Ready' },
    { value: 'sent', label: 'Sent' }
];

const formatUpdatedAt = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
};

const VestryWorkflowPanel = ({
    workflow,
    workflowBusy,
    workflowError,
    updateWorkflowField,
    saveWorkflow
}) => (
    <Card className="vestry-panel vestry-row-card">
        <div className="panel-header compact">
            <h2>Workflow</h2>
            {workflow?.updatedAt ? <span className="panel-meta">Updated {formatUpdatedAt(workflow.updatedAt)}</span> : null}
        </div>
        {workflowError ? <div className="alert error">{workflowError}</div> : null}
        <div className="form-row">
            <div className="form-group">
                <label htmlFor="vestry-agenda-status">Agenda status</label>
                <select
                    id="vestry-agenda-status"
                    value={workflow.agendaStatus}
                    onChange={(event) => updateWorkflowField('agendaStatus', event.target.value)}
                >
                    {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label htmlFor="vestry-packet-status">Packet status</label>
                <select
                    id="vestry-packet-status"
                    value={workflow.packetStatus}
                    onChange={(event) => updateWorkflowField('packetStatus', event.target.value)}
                >
                    {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>
        </div>
        <div className="form-row">
            <div className="form-group">
                <label htmlFor="vestry-agenda-ref">Agenda reference</label>
                <input
                    id="vestry-agenda-ref"
                    value={workflow.agendaRef || ''}
                    onChange={(event) => updateWorkflowField('agendaRef', event.target.value)}
                    placeholder="Agenda file/link"
                />
            </div>
            <div className="form-group">
                <label htmlFor="vestry-packet-ref">Packet reference</label>
                <input
                    id="vestry-packet-ref"
                    value={workflow.packetRef || ''}
                    onChange={(event) => updateWorkflowField('packetRef', event.target.value)}
                    placeholder="Packet file/link"
                />
            </div>
        </div>
        <div className="form-group">
            <label htmlFor="vestry-workflow-notes">Workflow notes</label>
            <textarea
                id="vestry-workflow-notes"
                rows="3"
                value={workflow.notes || ''}
                onChange={(event) => updateWorkflowField('notes', event.target.value)}
            />
        </div>
        <div className="form-actions">
            <button className="btn-secondary" type="button" disabled={workflowBusy} onClick={() => saveWorkflow()}>
                {workflowBusy ? 'Saving...' : 'Save Workflow'}
            </button>
            <button
                className="btn-primary"
                type="button"
                disabled={workflowBusy}
                onClick={() => saveWorkflow({ ...workflow, agendaStatus: 'ready', packetStatus: 'sent' })}
            >
                Mark Packet Sent
            </button>
        </div>
    </Card>
);

export default VestryWorkflowPanel;
