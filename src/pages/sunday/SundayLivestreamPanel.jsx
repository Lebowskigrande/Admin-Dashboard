import Card from '../../components/Card';
import { FaYoutube } from 'react-icons/fa';
import { format, parseISO } from 'date-fns';

const SundayLivestreamPanel = ({
    renderMilestoneInline,
    emailMilestone,
    isMilestoneComplete,
    livestreamUrl,
    details,
    toggleEmailChecklistItem,
    livestreamError,
    onGenerateAndScheduleEmail,
    schedulingEmail,
    emailError,
    emailScheduledDate
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
                <div className={`check-item ${details.emailCreated ? 'done' : ''}`}>
                    <span className={`check-badge check-badge--sm ${details.emailCreated ? '' : 'check-badge--empty'}`} aria-hidden="true">
                        {details.emailCreated ? '\u2713' : ''}
                    </span>
                    <span>Email created</span>
                </div>
                <div className={`check-item ${details.emailScheduled ? 'done' : ''}`}>
                    <span className={`check-badge check-badge--sm ${details.emailScheduled ? '' : 'check-badge--empty'}`} aria-hidden="true">
                        {details.emailScheduled ? '\u2713' : ''}
                    </span>
                    <span>Email scheduled</span>
                </div>
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
        <button
            type="button"
            className="btn-primary"
            onClick={onGenerateAndScheduleEmail}
            disabled={schedulingEmail}
        >
            {schedulingEmail ? 'Scheduling...' : 'Generate + Schedule Email'}
        </button>
        {emailScheduledDate && (
            <div className="text-muted">
                Scheduled for {format(parseISO(emailScheduledDate), 'PPP p')}
            </div>
        )}
        {emailError && <div className="text-muted">{emailError}</div>}
        {livestreamError && <div className="text-muted">{livestreamError}</div>}
    </Card>
);

export default SundayLivestreamPanel;
