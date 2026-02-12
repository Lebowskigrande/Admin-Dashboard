import { useState } from 'react';
import { FaDownload, FaPaperPlane, FaPlus, FaTrash } from 'react-icons/fa';

import Card from '../../components/Card';

const VestryPacketBuilder = ({
    coveredMonth,
    requiredDocs,
    requiredUploaded,
    optionalUploaded,
    packetItems,
    packetBusy,
    packetError,
    packetUrl,
    packetFilename,
    packetCacheBusy,
    packetCacheError,
    mailtoBody,
    addCustomDoc,
    clearPacketCache,
    buildPacket,
    updatePacketItem,
    removeCustomDoc,
    handlePacketFileUpload,
    reorderPacketItems,
    hasPacketFile
}) => {
    const [draggedId, setDraggedId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);

    return (
        <Card className="vestry-panel full-span">
            <div className="packet-header">
                <div>
                    <h2>{`Next Vestry Packet${coveredMonth ? `: ${coveredMonth} Financials` : ''}`}</h2>
                    <p className="text-muted">Upload each document, reorder if needed, then build a single PDF packet.</p>
                    <div className="packet-summary">
                        Required uploaded: {requiredUploaded}/{requiredDocs.length}. Optional uploaded: {optionalUploaded}.
                    </div>
                </div>
                <div className="packet-actions">
                    <button className="btn-secondary" onClick={addCustomDoc}>
                        <FaPlus /> Add Document
                    </button>
                    <button className="btn-secondary" onClick={clearPacketCache} disabled={packetCacheBusy}>
                        {packetCacheBusy ? 'Clearing...' : 'Clear Cached Files'}
                    </button>
                    <button className="btn-primary" onClick={buildPacket} disabled={packetBusy}>
                        {packetBusy ? 'Building...' : 'Build Packet'}
                    </button>
                    {packetUrl && (
                        <>
                            <a href={packetUrl} download={packetFilename} className="btn-icon" aria-label="Download packet">
                                <FaDownload />
                            </a>
                            <a
                                className="btn-icon"
                                href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent('vestry@saintedmunds.org')}&su=${encodeURIComponent('Vestry packet')}&body=${encodeURIComponent(mailtoBody)}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Send to Vestry"
                            >
                                <FaPaperPlane />
                            </a>
                        </>
                    )}
                </div>
            </div>
            {packetError && <div className="alert error">{packetError}</div>}
            {packetCacheError && <div className="alert error">{packetCacheError}</div>}
            <div className="packet-list compact">
                {packetItems.map((item) => (
                    <div
                        key={item.id}
                        className={`packet-row compact ${dragOverId === item.id ? 'drag-over' : ''}`}
                        draggable
                        onDragStart={() => setDraggedId(item.id)}
                        onDragEnd={() => {
                            setDraggedId(null);
                            setDragOverId(null);
                        }}
                        onDragOver={(event) => {
                            event.preventDefault();
                            if (dragOverId !== item.id) setDragOverId(item.id);
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            reorderPacketItems(draggedId, item.id);
                            setDraggedId(null);
                            setDragOverId(null);
                        }}
                    >
                        <div className="packet-order">
                            <span className="drag-handle" aria-hidden="true">::</span>
                        </div>
                        <div className="packet-meta">
                            {item.custom ? (
                                <input
                                    type="text"
                                    value={item.label}
                                    onChange={(event) => updatePacketItem(item.id, { label: event.target.value })}
                                />
                            ) : (
                                <span className="packet-label">{item.label}</span>
                            )}
                            <div className="packet-status">
                                {item.required && <span className="packet-required">Required</span>}
                                <span className={hasPacketFile(item) ? 'status-pill ready' : 'status-pill missing'}>
                                    {item.uploading
                                        ? 'Uploading...'
                                        : item.file
                                            ? `Uploaded: ${item.file.name}`
                                            : item.cachedFile
                                                ? `Cached: ${item.cachedFile.originalName || 'document'}`
                                                : 'No file yet'}
                                </span>
                            </div>
                        </div>
                        <input
                            type="file"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={(event) => {
                                const file = event.target.files?.[0] || null;
                                if (file) {
                                    handlePacketFileUpload(item.id, file);
                                }
                                event.target.value = '';
                            }}
                        />
                        {item.custom && (
                            <button className="btn-link" onClick={() => removeCustomDoc(item.id)}>
                                <FaTrash />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </Card>
    );
};

export default VestryPacketBuilder;
