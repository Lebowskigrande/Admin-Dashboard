import { FaPrint, FaSave } from 'react-icons/fa';

import Card from '../../components/Card';
import Modal from '../../components/Modal';
import { formatCurrency } from '../../utils/formatters';

const VestryCertificatePanel = ({
    certificateItems,
    certificateAmounts,
    certificateBusy,
    certificateError,
    previewModal,
    previewError,
    previewNotice,
    previewActionBusy,
    hasQuarterlyInterest,
    updateCertificateAmount,
    generateCertificatePreview,
    closePreviewModal,
    saveCertificate,
    printCertificate
}) => (
    <>
        <Card className="vestry-panel vestry-row-card">
            <div className="panel-header compact">
                <h2>Certificates</h2>
            </div>
            <div className="certificate-panel">
                {certificateItems.length === 0 ? (
                    <span className="text-muted">No certificates listed for this meeting.</span>
                ) : (
                    <>
                        {certificateError && <div className="alert error">{certificateError}</div>}
                        <div className="certificate-group">
                            <div className="certificate-title">Fund A</div>
                            <div className="certificate-fields">
                                <label className="certificate-field">
                                    <span>Monthly transfer</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="$0.00"
                                        value={certificateAmounts.fundA.monthlyAmount}
                                        onChange={(event) => updateCertificateAmount('fundA', 'monthlyAmount', event.target.value)}
                                        onBlur={(event) => updateCertificateAmount('fundA', 'monthlyAmount', formatCurrency(event.target.value))}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Reason"
                                        value={certificateAmounts.fundA.monthlyReason}
                                        onChange={(event) => updateCertificateAmount('fundA', 'monthlyReason', event.target.value)}
                                    />
                                </label>
                                {hasQuarterlyInterest && (
                                    <label className="certificate-field">
                                        <span>Quarterly interest transfer</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="$0.00"
                                            value={certificateAmounts.fundA.interestAmount}
                                            onChange={(event) => updateCertificateAmount('fundA', 'interestAmount', event.target.value)}
                                            onBlur={(event) => updateCertificateAmount('fundA', 'interestAmount', formatCurrency(event.target.value))}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Reason"
                                            value={certificateAmounts.fundA.interestReason}
                                            onChange={(event) => updateCertificateAmount('fundA', 'interestReason', event.target.value)}
                                        />
                                    </label>
                                )}
                            </div>
                            <button
                                className="btn-secondary certificate-action"
                                type="button"
                                disabled={!hasQuarterlyInterest || certificateBusy.fundA}
                                onClick={() => generateCertificatePreview('fundA')}
                            >
                                {certificateBusy.fundA ? 'Generating...' : 'Generate Preview'}
                            </button>
                            {!hasQuarterlyInterest && (
                                <span className="text-muted">Quarterly templates not configured yet.</span>
                            )}
                        </div>
                        <div className="certificate-group">
                            <div className="certificate-title">Fund B</div>
                            <div className="certificate-fields">
                                <label className="certificate-field">
                                    <span>Shared expenses transfer</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="$0.00"
                                        value={certificateAmounts.fundB.monthlyAmount}
                                        onChange={(event) => updateCertificateAmount('fundB', 'monthlyAmount', event.target.value)}
                                        onBlur={(event) => updateCertificateAmount('fundB', 'monthlyAmount', formatCurrency(event.target.value))}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Reason"
                                        value={certificateAmounts.fundB.monthlyReason}
                                        onChange={(event) => updateCertificateAmount('fundB', 'monthlyReason', event.target.value)}
                                    />
                                </label>
                                {hasQuarterlyInterest && (
                                    <label className="certificate-field">
                                        <span>Quarterly interest transfer</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="$0.00"
                                            value={certificateAmounts.fundB.interestAmount}
                                            onChange={(event) => updateCertificateAmount('fundB', 'interestAmount', event.target.value)}
                                            onBlur={(event) => updateCertificateAmount('fundB', 'interestAmount', formatCurrency(event.target.value))}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Reason"
                                            value={certificateAmounts.fundB.interestReason}
                                            onChange={(event) => updateCertificateAmount('fundB', 'interestReason', event.target.value)}
                                        />
                                    </label>
                                )}
                            </div>
                            <button
                                className="btn-secondary certificate-action"
                                type="button"
                                disabled={!hasQuarterlyInterest || certificateBusy.fundB}
                                onClick={() => generateCertificatePreview('fundB')}
                            >
                                {certificateBusy.fundB ? 'Generating...' : 'Generate Preview'}
                            </button>
                            {!hasQuarterlyInterest && (
                                <span className="text-muted">Quarterly templates not configured yet.</span>
                            )}
                        </div>
                        {hasQuarterlyInterest && (
                            <div className="certificate-group">
                                <div className="certificate-title">Fidelity Fund</div>
                                <div className="certificate-fields">
                                    <label className="certificate-field">
                                        <span>Quarterly interest transfer</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="$0.00"
                                            value={certificateAmounts.fidelity.interestAmount}
                                            onChange={(event) => updateCertificateAmount('fidelity', 'interestAmount', event.target.value)}
                                            onBlur={(event) => updateCertificateAmount('fidelity', 'interestAmount', formatCurrency(event.target.value))}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Reason"
                                            value={certificateAmounts.fidelity.interestReason}
                                            onChange={(event) => updateCertificateAmount('fidelity', 'interestReason', event.target.value)}
                                        />
                                    </label>
                                </div>
                                <button
                                    className="btn-secondary certificate-action"
                                    type="button"
                                    disabled={certificateBusy.fidelity}
                                    onClick={() => generateCertificatePreview('fidelity')}
                                >
                                    {certificateBusy.fidelity ? 'Generating...' : 'Generate Preview'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Card>

        <Modal
            isOpen={previewModal.open}
            onClose={closePreviewModal}
            title="Certificate Preview"
            className="modal-large"
        >
            <div className="certificate-preview">
                <div className="certificate-preview-toolbar">
                    <div className="certificate-preview-meta">
                        <span className="certificate-preview-filename">
                            {previewModal.filename || 'Certificate Preview'}
                        </span>
                    </div>
                    <div className="certificate-preview-actions">
                        <button
                            className="btn-icon"
                            type="button"
                            aria-label="Save certificate"
                            disabled={!previewModal.url || previewActionBusy.save}
                            onClick={saveCertificate}
                        >
                            <FaSave />
                        </button>
                        <button
                            className="btn-icon"
                            type="button"
                            aria-label="Print certificate"
                            disabled={!previewModal.url || previewActionBusy.print}
                            onClick={printCertificate}
                        >
                            <FaPrint />
                        </button>
                    </div>
                </div>
                {previewError && <div className="alert error">{previewError}</div>}
                {previewNotice && <div className="alert success">{previewNotice}</div>}
                <div className="certificate-preview-frame">
                    {previewModal.url ? (
                        <img src={previewModal.url} alt="Certificate preview" />
                    ) : (
                        <span className="text-muted">No preview available.</span>
                    )}
                </div>
            </div>
        </Modal>
    </>
);

export default VestryCertificatePanel;
