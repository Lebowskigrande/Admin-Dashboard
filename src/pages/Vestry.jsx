import { format } from 'date-fns';

import Card from '../components/Card';
import VestryCertificatePanel from './vestry/VestryCertificatePanel';
import VestryChecklist from './vestry/VestryChecklist';
import VestryMembersPanel from './vestry/VestryMembersPanel';
import VestryPacketBuilder from './vestry/VestryPacketBuilder';
import { useVestryData } from './vestry/useVestryData';
import './Vestry.css';
import '../styles/people-shared.css';
import './People.css';

const Vestry = () => {
    const {
        vestryMembers,
        sortedVestryMembers,
        checklistItems,
        checklistGroups,
        checklistProgress,
        packetItems,
        packetBusy,
        packetError,
        packetUrl,
        packetFilename,
        packetCacheBusy,
        packetCacheError,
        certificateBusy,
        certificateError,
        certificateAmounts,
        previewModal,
        previewError,
        previewNotice,
        previewActionBusy,
        vestryMeetings,
        nextMeeting,
        selectedMeeting,
        otherMeetings,
        coveredMonth,
        mailtoBody,
        requiredDocs,
        requiredUploaded,
        excludedRequiredCount,
        optionalUploaded,
        completedCount,
        hasQuarterlyInterest,
        certificateItems,
        setChecklistProgress,
        setSelectedMeeting,
        updateCertificateAmount,
        generateCertificatePreview,
        closePreviewModal,
        saveCertificate,
        printCertificate,
        updatePacketItem,
        reorderPacketItems,
        addCustomDoc,
        removeCustomDoc,
        handlePacketFileUpload,
        clearPacketCache,
        buildPacket,
        hasPacketFile
    } = useVestryData();

    return (
        <div className="page-vestry">
            <header className="vestry-header page-header-bar">
                <div className="page-header-title">
                    <h1>Vestry</h1>
                    <p className="page-subtitle page-header-subtitle">
                        Track members, meeting cadence, committee schedules, and packet documents.
                    </p>
                </div>
            </header>

            <VestryMembersPanel
                vestryMembers={vestryMembers}
                sortedVestryMembers={sortedVestryMembers}
            />

            <div className="vestry-grid">
                <VestryChecklist
                    checklistItems={checklistItems}
                    checklistGroups={checklistGroups}
                    checklistProgress={checklistProgress}
                    setChecklistProgress={setChecklistProgress}
                    selectedMeeting={selectedMeeting}
                    completedCount={completedCount}
                />

                <VestryCertificatePanel
                    certificateItems={certificateItems}
                    certificateAmounts={certificateAmounts}
                    certificateBusy={certificateBusy}
                    certificateError={certificateError}
                    previewModal={previewModal}
                    previewError={previewError}
                    previewNotice={previewNotice}
                    previewActionBusy={previewActionBusy}
                    hasQuarterlyInterest={hasQuarterlyInterest}
                    updateCertificateAmount={updateCertificateAmount}
                    generateCertificatePreview={generateCertificatePreview}
                    closePreviewModal={closePreviewModal}
                    saveCertificate={saveCertificate}
                    printCertificate={printCertificate}
                />

                <Card className="vestry-panel vestry-row-card">
                    <div className="panel-header compact stack">
                        <h2>Vestry Meetings</h2>
                        <span className="panel-meta">6:30pm in the Library</span>
                    </div>
                    <div className="meeting-list compact">
                        {vestryMeetings.map((meeting) => {
                            const isNext = !!nextMeeting && meeting.toDateString() === nextMeeting.toDateString();
                            const isActive = !!selectedMeeting && meeting.toDateString() === selectedMeeting.toDateString();
                            return (
                                <button
                                    key={meeting.toISOString()}
                                    type="button"
                                    className={`meeting-row ${isNext ? 'next' : ''} ${isActive ? 'active' : ''}`}
                                    onClick={() => setSelectedMeeting(meeting)}
                                >
                                    <div>
                                        <strong>{format(meeting, 'MMMM d, yyyy')}</strong>
                                        <div className="text-muted">
                                            {meeting.getMonth() === 10 || meeting.getMonth() === 11 ? '3rd Thursday' : '4th Thursday'}
                                        </div>
                                    </div>
                                    {isNext && <span className="meeting-tag next-tag">Next</span>}
                                </button>
                            );
                        })}
                    </div>
                </Card>

                <Card className="vestry-panel vestry-row-card">
                    <div className="panel-header compact">
                        <h2>Other Meetings</h2>
                    </div>
                    <div className="meeting-list compact">
                        {otherMeetings.length === 0 && (
                            <span className="text-muted">No other meetings scheduled.</span>
                        )}
                        {otherMeetings.map((meeting) => (
                            <div key={`${meeting.id}-${meeting.date}`} className="meeting-row other-meeting-row">
                                <div>
                                    <strong>{meeting.title}</strong>
                                    <div className="text-muted">
                                        {format(meeting.date, 'MMM d, yyyy')} - {meeting.time || 'All day'} - {meeting.location || 'TBD'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>

                <VestryPacketBuilder
                    coveredMonth={coveredMonth}
                    requiredDocs={requiredDocs}
                    requiredUploaded={requiredUploaded}
                    excludedRequiredCount={excludedRequiredCount}
                    optionalUploaded={optionalUploaded}
                    packetItems={packetItems}
                    packetBusy={packetBusy}
                    packetError={packetError}
                    packetUrl={packetUrl}
                    packetFilename={packetFilename}
                    packetCacheBusy={packetCacheBusy}
                    packetCacheError={packetCacheError}
                    mailtoBody={mailtoBody}
                    addCustomDoc={addCustomDoc}
                    clearPacketCache={clearPacketCache}
                    buildPacket={buildPacket}
                    updatePacketItem={updatePacketItem}
                    removeCustomDoc={removeCustomDoc}
                    handlePacketFileUpload={handlePacketFileUpload}
                    reorderPacketItems={reorderPacketItems}
                    hasPacketFile={hasPacketFile}
                />
            </div>
        </div>
    );
};

export default Vestry;
