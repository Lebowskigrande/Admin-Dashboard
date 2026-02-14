import Card from '../../components/Card';
import { FaYoutube } from 'react-icons/fa';

const SundayLivestreamPanel = ({
    renderMilestoneInline,
    emailMilestone,
    isMilestoneComplete,
    livestreamUrl,
    details,
    toggleEmailChecklistItem,
    livestreamError,
    ccConnected,
    ccLoading,
    ccFromEmails,
    ccFromEmail,
    setCcFromEmail,
    ccEmailBusy,
    ccEmailError,
    ccEmailSuccess,
    onCreateLivestreamEmail
}) => (
    <Card className={`sunday-panel livestream-card ${livestreamUrl && details.bulletinUploaded && details.emailCreated && details.emailScheduled && details.emailSent ? 'panel-complete' : ''}`}>
        {renderMilestoneInline('Livestream Email', emailMilestone)}

        {isMilestoneComplete(emailMilestone, emailMilestone?.key || 'email') && (
            <span className="check-badge panel-check" aria-hidden="true">&#10003;</span>
        )}

        <div className="email-checklist-wrapper">
            <div className="email-checklist">
                <div className={`check-item ${livestreamUrl ? 'done' : ''}`}>
                    <span className={`check-badge check-badge--sm ${livestreamUrl ? '' : 'check-badge--empty'}`} aria-hidden="true">
                    {livestreamUrl ? '\u2713' : ''}
                    </span>
                    <span>Livestream setup</span>
                    {livestreamUrl && (
                        <a
                            className="btn-icon btn-icon-ghost youtube-link"
                            href={livestreamUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open YouTube livestream"
                            title="Open YouTube"
                        >
                            <FaYoutube />
                        </a>
                    )}
                </div>
                <button
                    type="button"
                    className={`check-item check-action ${details.bulletinUploaded ? 'done' : ''}`}
                    onClick={() => toggleEmailChecklistItem('bulletinUploaded')}
                >
                    <span className={`check-badge check-badge--sm ${details.bulletinUploaded ? '' : 'check-badge--empty'}`} aria-hidden="true">
                        {details.bulletinUploaded ? '\u2713' : ''}
                    </span>
                    <span>Bulletin uploaded</span>
                </button>
                <button
                    type="button"
                    className={`check-item check-action ${details.emailCreated ? 'done' : ''}`}
                    onClick={() => toggleEmailChecklistItem('emailCreated')}
                >
                    <span className={`check-badge check-badge--sm ${details.emailCreated ? '' : 'check-badge--empty'}`} aria-hidden="true">
                        {details.emailCreated ? '\u2713' : ''}
                    </span>
                    <span>Email created</span>
                </button>
                <button
                    type="button"
                    className={`check-item check-action ${details.emailScheduled ? 'done' : ''}`}
                    onClick={() => toggleEmailChecklistItem('emailScheduled')}
                >
                    <span className={`check-badge check-badge--sm ${details.emailScheduled ? '' : 'check-badge--empty'}`} aria-hidden="true">
                        {details.emailScheduled ? '\u2713' : ''}
                    </span>
                    <span>Email scheduled</span>
                </button>
                <button
                    type="button"
                    className={`check-item check-action ${details.emailSent ? 'done' : ''}`}
                    onClick={() => toggleEmailChecklistItem('emailSent')}
                >
                    <span className={`check-badge check-badge--sm ${details.emailSent ? '' : 'check-badge--empty'}`} aria-hidden="true">
                        {details.emailSent ? '\u2713' : ''}
                    </span>
                    <span>Email sent</span>
                </button>
            </div>
        </div>

        <div className="email-sender-row">
            <span className="email-sender-label">From</span>
            <select
                className="email-sender-select"
                value={ccFromEmail}
                onChange={(event) => setCcFromEmail(event.target.value)}
                disabled={ccLoading || !ccConnected || ccEmailBusy || ccFromEmails.length === 0}
            >
                {ccFromEmails.length === 0 ? (
                    <option value="">No sender emails</option>
                ) : (
                    ccFromEmails.map((entry, index) => {
                        const email = entry?.email_address || entry?.email || entry?.address || '';
                        const status = String(entry?.status || '').trim() || 'unknown';
                        return (
                            <option key={`${email}-${index}`} value={email}>
                                {email} ({status})
                            </option>
                        );
                    })
                )}
            </select>
        </div>

        <div className="panel-actions panel-actions-bottom">
            <button
                type="button"
                className="btn-primary"
                disabled={ccLoading || !ccConnected || ccEmailBusy || !livestreamUrl || !details.bulletinUploadUrl || !details.bulletinImageUrl}
                onClick={onCreateLivestreamEmail}
            >
                {ccEmailBusy ? 'Creating/Scheduling...' : 'Create + Schedule Email'}
            </button>
        </div>
        {!ccConnected && !ccLoading && <div className="text-muted">Constant Contact is not connected.</div>}
        {ccEmailError && <div className="text-muted">{ccEmailError}</div>}
        {ccEmailSuccess && <div className="text-muted">{ccEmailSuccess}</div>}
        {livestreamError && <div className="text-muted">{livestreamError}</div>}
    </Card>
);

export default SundayLivestreamPanel;
