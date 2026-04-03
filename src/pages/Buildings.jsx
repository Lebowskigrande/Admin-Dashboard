import { FaTools, FaClipboardList, FaAddressBook, FaFileAlt } from 'react-icons/fa';
import BuildingsNeeds from './buildings/BuildingsNeeds';
import BuildingsVendors from './buildings/BuildingsVendors';
import BuildingsTickets from './buildings/BuildingsTickets';
import BuildingsMap from './buildings/BuildingsMap';
import BuildingsTicketModal from './buildings/BuildingsTicketModal';
import BuildingsRecords from './buildings/BuildingsRecords';
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
        ticketRecommendations,
        ticketRecommendationsLoading,
        ticketRecommendationsError,
        showTicketModal,
        selectedTicketId,
        archiveExpanded,
        ticketStatusExpandedKey,
        ticketsViewRef,
        roomsExpanded,
        roomsListRef,
        roomsHeight,
        newTicket,
        newNote,
        newTaskText,
        needs,
        needsLoading,
        needsError,
        newNeed,
        vendors,
        vendorsLoading,
        vendorsError,
        architecturalOverview,
        architecturalOverviewLoading,
        architecturalOverviewError,
        activeArchitecturalRecords,
        activeArchitecturalLayers,
        activeArchitecturalUtilities,
        activeArchitecturalSystems,
        activeArchitecturalSummary,
        mapAreas,
        orderedAreas,
        areaById,
        activeDetails,
        activeBuilding,
        activeAreaTickets,
        selectedTicket,
        formatSqft,
        setActiveTab,
        setActiveArea,
        setHoveredArea,
        setShowTicketModal,
        setSelectedTicketId,
        setArchiveExpanded,
        setTicketStatusExpandedKey,
        setRoomsExpanded,
        setNewTicket,
        setNewNote,
        setNewTaskText,
        setNewNeed,
        openTicketModal,
        toggleTicketArea,
        createTicket,
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
                    <p className="page-header-subtitle">Facilities tickets, campus map context, vendors, and architectural records in one workspace.</p>
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
                <button className={`tab-btn ${activeTab === 'records' ? 'active' : ''}`} onClick={() => setActiveTab('records')}>
                    <FaFileAlt /> Architectural Records
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
                    ticketRecommendations={ticketRecommendations}
                    ticketRecommendationsLoading={ticketRecommendationsLoading}
                    ticketRecommendationsError={ticketRecommendationsError}
                    selectedTicketId={selectedTicketId}
                    selectedTicket={selectedTicket}
                    archiveExpanded={archiveExpanded}
                    ticketStatusExpandedKey={ticketStatusExpandedKey}
                    ticketsViewRef={ticketsViewRef}
                    areaById={areaById}
                    newNote={newNote}
                    newTaskText={newTaskText}
                    setNewNote={setNewNote}
                    setNewTaskText={setNewTaskText}
                    setSelectedTicketId={setSelectedTicketId}
                    setArchiveExpanded={setArchiveExpanded}
                    setTicketStatusExpandedKey={setTicketStatusExpandedKey}
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
                    buildingsError={buildingsError}
                    roomsExpanded={roomsExpanded}
                    setRoomsExpanded={setRoomsExpanded}
                    roomsHeight={roomsHeight}
                    roomsListRef={roomsListRef}
                    formatSqft={formatSqft}
                    activeAreaTickets={activeAreaTickets}
                    focusTicket={focusTicket}
                    setActiveTab={setActiveTab}
                    activeArchitecturalRecords={activeArchitecturalRecords}
                    activeArchitecturalLayers={activeArchitecturalLayers}
                    activeArchitecturalUtilities={activeArchitecturalUtilities}
                    activeArchitecturalSystems={activeArchitecturalSystems}
                    activeArchitecturalSummary={activeArchitecturalSummary}
                    architecturalAreaLoading={architecturalOverviewLoading}
                />
            )}
            {activeTab === 'vendors' && (
                <BuildingsVendors
                    vendors={vendors}
                    vendorsLoading={vendorsLoading}
                    vendorsError={vendorsError}
                />
            )}
            {activeTab === 'records' && (
                <BuildingsRecords
                    recordsOverview={architecturalOverview}
                    recordsLoading={architecturalOverviewLoading}
                    recordsError={architecturalOverviewError}
                    mapAreas={mapAreas}
                    areaById={areaById}
                    setActiveTab={setActiveTab}
                    setActiveArea={setActiveArea}
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
                onClose={() => setShowTicketModal(false)}
                newTicket={newTicket}
                setNewTicket={setNewTicket}
                mapAreas={mapAreas}
                toggleTicketArea={toggleTicketArea}
                createTicket={createTicket}
            />
        </div>
    );
};

export default Buildings;
