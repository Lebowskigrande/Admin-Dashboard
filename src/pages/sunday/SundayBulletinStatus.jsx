import Card from '../../components/Card';
import { FaFolderOpen, FaUpload, FaPrint, FaSyncAlt } from 'react-icons/fa';

const SundayBulletinStatus = ({
    bulletinMilestone,
    insertMilestone,
    bulletinDoc,
    bulletin8Doc,
    insertDoc,
    statusDrafts,
    bulletin10Status,
    bulletin8Status,
    insertStatus,
    renderMilestoneInline,
    isMilestoneComplete,
    refreshDocPreviews,
    getPreviewLoading,
    docsLoading,
    bulletinPrintCopies,
    onChangeBulletin10Copies,
    onChangeBulletin8Copies,
    onChangeInsertCopies,
    onOpenFileLocation,
    onPrintBulletin10,
    onPrintBulletin8,
    onPrintInsert,
    onUploadBulletin,
    uploadingBulletin,
    uploadError
}) => (
    <>
        <Card
            id="bulletin-10am"
            className={`sunday-panel bulletin-card ${(statusDrafts.bulletin10 || bulletin10Status) === 'printed' ? 'panel-complete' : ''}`}
        >
            {renderMilestoneInline('10am Bulletin', bulletinMilestone, 'bulletins-10am')}
            {isMilestoneComplete(bulletinMilestone, 'bulletins-10am') && (
                <span className="check-badge panel-check" aria-hidden="true">&#10003;</span>
            )}

            <div className="doc-preview">
                <button
                    type="button"
                    className="doc-preview-refresh"
                    onClick={() => refreshDocPreviews('bulletin10')}
                    disabled={getPreviewLoading('bulletin10')}
                    aria-label="Refresh preview"
                    title="Refresh preview"
                >
                    <FaSyncAlt />
                </button>
                {getPreviewLoading('bulletin10') && <span className="doc-spinner" aria-hidden="true" />}
                {bulletinDoc?.preview ? (
                    <img src={bulletinDoc.preview} alt="10am bulletin preview" />
                ) : docsLoading ? null : (
                    <div className="doc-preview-empty">No bulletin preview</div>
                )}
            </div>
            <div className="panel-actions panel-actions-bottom">
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={() => onOpenFileLocation(bulletinDoc?.path)}
                    disabled={!bulletinDoc?.exists}
                    aria-label="Open 10am bulletin folder"
                    title="Open File Location"
                >
                    <FaFolderOpen />
                </button>
                <input
                    type="number"
                    min="1"
                    className="print-copies-input"
                    value={bulletinPrintCopies.bulletin10}
                    onChange={onChangeBulletin10Copies}
                    aria-label="10am bulletin copies"
                />
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={onPrintBulletin10}
                    disabled={!bulletinDoc?.exists}
                    aria-label="Print 10am bulletin"
                    title="Print"
                >
                    <FaPrint />
                </button>
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={onUploadBulletin}
                    disabled={!bulletinDoc?.exists || uploadingBulletin}
                    aria-label="Upload 10am bulletin"
                    title="Upload to WordPress"
                >
                    {uploadingBulletin ? <span className="btn-icon-loading" aria-hidden="true" /> : <FaUpload />}
                </button>
            </div>
            {uploadError && <div className="text-muted">{uploadError}</div>}
        </Card>
        <Card
            id="bulletin-8am"
            className={`sunday-panel bulletin-card ${(statusDrafts.bulletin8 || bulletin8Status) === 'printed' ? 'panel-complete' : ''}`}
        >
            {renderMilestoneInline('8am Bulletin', bulletinMilestone, 'bulletins-8am')}
            {isMilestoneComplete(bulletinMilestone, 'bulletins-8am') && (
                <span className="check-badge panel-check" aria-hidden="true">&#10003;</span>
            )}

            <div className="doc-preview">
                <button
                    type="button"
                    className="doc-preview-refresh"
                    onClick={() => refreshDocPreviews('bulletin8')}
                    disabled={getPreviewLoading('bulletin8')}
                    aria-label="Refresh preview"
                    title="Refresh preview"
                >
                    <FaSyncAlt />
                </button>
                {getPreviewLoading('bulletin8') && <span className="doc-spinner" aria-hidden="true" />}
                {bulletin8Doc?.preview ? (
                    <img src={bulletin8Doc.preview} alt="8am bulletin preview" />
                ) : docsLoading ? null : (
                    <div className="doc-preview-empty">No bulletin preview</div>
                )}
            </div>
            <div className="panel-actions panel-actions-bottom">
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={() => onOpenFileLocation(bulletin8Doc?.path)}
                    disabled={!bulletin8Doc?.exists}
                    aria-label="Open 8am bulletin folder"
                    title="Open File Location"
                >
                    <FaFolderOpen />
                </button>
                <input
                    type="number"
                    min="1"
                    className="print-copies-input"
                    value={bulletinPrintCopies.bulletin8}
                    onChange={onChangeBulletin8Copies}
                    aria-label="8am bulletin copies"
                />
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={onPrintBulletin8}
                    disabled={!bulletin8Doc?.exists}
                    aria-label="Print 8am bulletin"
                    title="Print"
                >
                    <FaPrint />
                </button>
            </div>
        </Card>
        <Card
            className={`sunday-panel insert-card ${(statusDrafts.insert || insertStatus) === 'stuffed' ? 'panel-complete' : ''}`}
        >
            {renderMilestoneInline('Insert', insertMilestone)}
            {isMilestoneComplete(insertMilestone, insertMilestone?.key || 'insert') && (
                <span className="check-badge panel-check" aria-hidden="true">&#10003;</span>
            )}

            <div className="doc-preview">
                <button
                    type="button"
                    className="doc-preview-refresh"
                    onClick={() => refreshDocPreviews('insert')}
                    disabled={getPreviewLoading('insert')}
                    aria-label="Refresh preview"
                    title="Refresh preview"
                >
                    <FaSyncAlt />
                </button>
                {getPreviewLoading('insert') && <span className="doc-spinner" aria-hidden="true" />}
                {insertDoc.preview ? (
                    <img src={insertDoc.preview} alt="Insert preview" />
                ) : docsLoading ? null : (
                    <div className="doc-preview-empty">No insert preview</div>
                )}
            </div>
            <div className="panel-actions panel-actions-bottom">
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={() => onOpenFileLocation(insertDoc.path)}
                    disabled={!insertDoc.exists}
                    aria-label="Open insert folder"
                    title="Open File Location"
                >
                    <FaFolderOpen />
                </button>
                <input
                    type="number"
                    min="1"
                    className="print-copies-input"
                    value={bulletinPrintCopies.insert}
                    onChange={onChangeInsertCopies}
                    aria-label="Insert copies"
                />
                <button
                    type="button"
                    className="btn-icon btn-icon-ghost"
                    onClick={onPrintInsert}
                    disabled={!insertDoc.exists}
                    aria-label="Print insert"
                    title="Print"
                >
                    <FaPrint />
                </button>
            </div>
        </Card>
    </>
);

export default SundayBulletinStatus;
