import { FaTools, FaClipboardList, FaAddressBook } from 'react-icons/fa';
import BuildingsNeeds from './buildings/BuildingsNeeds';
import BuildingsVendors from './buildings/BuildingsVendors';
import BuildingsTickets from './buildings/BuildingsTickets';
import BuildingsMap from './buildings/BuildingsMap';
import BuildingsTicketModal from './buildings/BuildingsTicketModal';
import { useBuildingsData } from './buildings/useBuildingsData';
import './Buildings.css';

const Buildings = () => {
    const {
        activeTab,
        activeArea,
        hoveredArea,
        buildingsError,
        tickets,
        ticketsLoading,
        ticketsError,
        showTicketModal,
        ticketFocus,
        editingTicketId,
        selectedTicketId,
        archiveExpanded,
        ticketsViewRef,
        roomsExpanded,
        roomsListRef,
        roomsHeight,
        ticketDraft,
        newNote,
        newTaskText,
        needs,
        needsLoading,
        needsError,
        newNeed,
        vendors,
        vendorsLoading,
        vendorsError,
        mapAreas,
        orderedAreas,
        areaById,
        activeDetails,
        activeBuilding,
        activeBuildingEvents,
        buildingEventsLoading,
        activeAreaTickets,
        selectedTicket,
        formatSqft,
        setActiveTab,
        setActiveArea,
        setHoveredArea,
        setTicketFocus,
        setSelectedTicketId,
        setArchiveExpanded,
        setRoomsExpanded,
        setTicketDraft,
        setNewNote,
        setNewTaskText,
        setNewNeed,
        openTicketModal,
        closeTicketModal,
        toggleTicketArea,
        saveTicket,
        updateTicket,
        addTicketNote,
        addTicketTask,
        toggleTicketTask,
        deleteTicketTask,
        addNeed,
        toggleNeed,
        focusTicket,
        clearSelection,
        shouldIgnoreDeselect
    } = useBuildingsData();

    return (
        <div
            className="page-buildings"
            onClickCapture={(event) => {
                if (!shouldIgnoreDeselect(event.target)) {
                    clearSelection();
                }
            }}
        >
            <header className="buildings-header page-header-bar">
                <div className="page-header-title">
                    <h1>Buildings & Grounds</h1>
                    <p className="page-header-subtitle">Facilities tickets, campus map context, vendors, and long-term needs in one workspace.</p>
                </div>
            </header>

            <div className="buildings-tabs">
                <button className={`tab-btn ${activeTab === 'tickets' ? 'active' : ''}`} onClick={() => setActiveTab('tickets')}>
                    <FaClipboardList /> Tickets
                </button>
                <button className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
                    <FaTools /> Campus Map
                </button>
                <button className={`tab-btn ${activeTab === 'vendors' ? 'active' : ''}`} onClick={() => setActiveTab('vendors')}>
                    <FaAddressBook /> Preferred Vendors
                </button>
                <button className={`tab-btn ${activeTab === 'needs' ? 'active' : ''}`} onClick={() => setActiveTab('needs')}>
                    <FaClipboardList /> Long Term Needs
                </button>
            </div>

            {activeTab === 'tickets' && (
                <BuildingsTickets
                    tickets={tickets}
                    ticketsLoading={ticketsLoading}
                    ticketsError={ticketsError}
                    selectedTicketId={selectedTicketId}
                    selectedTicket={selectedTicket}
                    archiveExpanded={archiveExpanded}
                    ticketFocus={ticketFocus}
                    ticketsViewRef={ticketsViewRef}
                    areaById={areaById}
                    vendors={vendors}
                    newNote={newNote}
                    newTaskText={newTaskText}
                    setNewNote={setNewNote}
                    setNewTaskText={setNewTaskText}
                    setActiveTab={setActiveTab}
                    setSelectedTicketId={setSelectedTicketId}
                    setArchiveExpanded={setArchiveExpanded}
                    setTicketFocus={setTicketFocus}
                    openTicketModal={openTicketModal}
                    updateTicket={updateTicket}
                    addTicketTask={addTicketTask}
                    toggleTicketTask={toggleTicketTask}
                    deleteTicketTask={deleteTicketTask}
                    addTicketNote={addTicketNote}
                />
            )}
            {activeTab === 'map' && (
                <BuildingsMap
                    mapAreas={mapAreas}
                    orderedAreas={orderedAreas}
                    activeArea={activeArea}
                    hoveredArea={hoveredArea}
                    setActiveArea={setActiveArea}
                    setHoveredArea={setHoveredArea}
                    activeDetails={activeDetails}
                    activeBuilding={activeBuilding}
                    activeBuildingEvents={activeBuildingEvents}
                    buildingEventsLoading={buildingEventsLoading}
                    buildingsError={buildingsError}
                    roomsExpanded={roomsExpanded}
                    setRoomsExpanded={setRoomsExpanded}
                    roomsHeight={roomsHeight}
                    roomsListRef={roomsListRef}
                    formatSqft={formatSqft}
                    activeAreaTickets={activeAreaTickets}
                    focusTicket={focusTicket}
                />
            )}
            {activeTab === 'vendors' && (
                <BuildingsVendors
                    vendors={vendors}
                    vendorsLoading={vendorsLoading}
                    vendorsError={vendorsError}
                />
            )}
            {activeTab === 'needs' && (
                <BuildingsNeeds
                    needs={needs}
                    needsLoading={needsLoading}
                    needsError={needsError}
                    newNeed={newNeed}
                    setNewNeed={setNewNeed}
                    addNeed={addNeed}
                    toggleNeed={toggleNeed}
                />
            )}

            <BuildingsTicketModal
                isOpen={showTicketModal}
                onClose={closeTicketModal}
                editingTicketId={editingTicketId}
                ticketDraft={ticketDraft}
                setTicketDraft={setTicketDraft}
                mapAreas={mapAreas}
                vendors={vendors}
                toggleTicketArea={toggleTicketArea}
                saveTicket={saveTicket}
            />
        </div>
    );
};

export default Buildings;
