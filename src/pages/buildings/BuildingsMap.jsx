import Card from '../../components/Card';
import { formatCurrency } from '../../utils/formatters';

const BuildingsMap = ({
    mapAreas,
    orderedAreas,
    activeArea,
    hoveredArea,
    setActiveArea,
    setHoveredArea,
    activeDetails,
    activeBuilding,
    buildingsError,
    roomsExpanded,
    setRoomsExpanded,
    roomsHeight,
    roomsListRef,
    formatSqft,
    activeAreaTickets,
    focusTicket
}) => (
    <Card className="campus-map-card">
        <div className="campus-map-layout">
            <Card
                className="campus-map-panel campus-map-list-panel"
                onMouseLeave={() => setHoveredArea(null)}
            >
                <h3>Locations</h3>
                <div className="map-list">
                    {orderedAreas.map((area) => {
                        const categoryKey = area.category
                            ? area.category.toLowerCase().replace(/\s+/g, '-')
                            : '';
                        const isSelected = activeArea?.id === area.id;
                        const isHovered = hoveredArea?.id === area.id;
                        return (
                            <button
                                key={area.id}
                                type="button"
                                className={`map-list-item ${isSelected ? 'selected' : ''} ${isHovered ? 'active' : ''}`}
                                data-area-id={area.id}
                                onMouseEnter={() => setHoveredArea(area)}
                                onFocus={() => setHoveredArea(area)}
                                onClick={() => setActiveArea(area)}
                            >
                                <span
                                    className={`map-dot map-dot-${area.type} ${categoryKey ? `map-dot-${categoryKey}` : ''}`}
                                />
                                {area.name}
                            </button>
                        );
                    })}
                </div>
            </Card>
            <div
                className="campus-map-wrapper"
                onMouseLeave={() => setHoveredArea(null)}
            >
                <img src="/map.png" alt="Campus map" className="campus-map-image" />
                <div className="campus-map-overlay">
                    <svg
                        className="campus-map-svg"
                        viewBox="0 0 554 1504"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        {mapAreas.map((area) => {
                            const isActive = hoveredArea?.id === area.id || activeArea?.id === area.id;
                            const categoryKey = area.category
                                ? area.category.toLowerCase().replace(/\s+/g, '-')
                                : '';
                            const className = `map-area map-area-${area.type} ${categoryKey ? `map-area-category-${categoryKey}` : ''} ${isActive ? 'active' : ''}`;

                            if (area.shape === 'poly') {
                                const points = area.points.map(pair => pair.join(',')).join(' ');
                                return (
                                    <polygon
                                        key={area.id}
                                        className={className}
                                        points={points}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={area.name}
                                        onMouseEnter={() => setHoveredArea(area)}
                                        onFocus={() => setHoveredArea(area)}
                                        onMouseLeave={() => setHoveredArea(null)}
                                        onBlur={() => setHoveredArea(null)}
                                        onClick={() => setActiveArea(area)}
                                    >
                                        <title>{area.name}</title>
                                    </polygon>
                                );
                            }

                            return (
                                <rect
                                    key={area.id}
                                    className={className}
                                    x={area.rect.x}
                                    y={area.rect.y}
                                    width={area.rect.width}
                                    height={area.rect.height}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={area.name}
                                    onMouseEnter={() => setHoveredArea(area)}
                                    onFocus={() => setHoveredArea(area)}
                                    onMouseLeave={() => setHoveredArea(null)}
                                    onBlur={() => setHoveredArea(null)}
                                    onClick={() => setActiveArea(area)}
                                >
                                    <title>{area.name}</title>
                                </rect>
                            );
                        })}
                    </svg>
                </div>
            </div>
            <Card
                className="campus-map-panel campus-map-details"
                onClickCapture={(event) => event.stopPropagation()}
            >
                {!activeDetails && (
                    <div className="map-empty">
                        <h3>Pick a location</h3>
                        <p>Click on an area of the map to view details.</p>
                    </div>
                )}
                {activeDetails && (
                    <>
                        <div className="map-pill-row">
                            <span className={`pill map-tag map-tag-${activeDetails?.type || 'building'}`}>
                                {activeDetails?.type === 'parking' ? 'Parking' : activeDetails?.type === 'grounds' ? 'Grounds' : activeDetails?.type === 'entry' ? 'Entry' : 'Building'}
                            </span>
                            {activeDetails?.category && (
                                <span className={`pill map-category map-category-${activeDetails.category.toLowerCase().replace(/\s+/g, '-')}`}>
                                    {activeDetails.category}
                                </span>
                            )}
                        </div>
                        <h3>{activeDetails?.name}</h3>
                        <p>{activeDetails?.description}</p>
                        {buildingsError && (
                            <div className="map-note">{buildingsError}</div>
                        )}
                        {activeBuilding && (
                            <div className="building-info">
                                <div className="building-stats">
                                    {activeBuilding.capacity ? (
                                        <div className="building-stat">
                                            <span>Capacity</span>
                                            <strong>{activeBuilding.capacity}</strong>
                                        </div>
                                    ) : null}
                                    {activeBuilding.rental_rate_hour ? (
                                        <div className="building-stat">
                                            <span>Hourly rate</span>
                                            <strong>{formatCurrency(activeBuilding.rental_rate_hour)}</strong>
                                        </div>
                                    ) : null}
                                    {activeBuilding.rental_rate_day ? (
                                        <div className="building-stat">
                                            <span>Rental rate</span>
                                            <strong>{formatCurrency(activeBuilding.rental_rate_day)}</strong>
                                        </div>
                                    ) : null}
                                    {activeBuilding.rental_rate && !activeBuilding.rental_rate_day && !activeBuilding.rental_rate_hour ? (
                                        <div className="building-stat">
                                            <span>Rental rate</span>
                                            <strong>{formatCurrency(activeBuilding.rental_rate)}</strong>
                                        </div>
                                    ) : null}
                                    {activeBuilding.parking_spaces ? (
                                        <div className="building-stat">
                                            <span>Parking</span>
                                            <strong>{activeBuilding.parking_spaces}</strong>
                                        </div>
                                    ) : null}
                                    {activeBuilding.size_sqft ? (
                                        <div className="building-stat">
                                            <span>Square footage</span>
                                            <strong>{formatSqft(activeBuilding.size_sqft)}</strong>
                                        </div>
                                    ) : null}
                                </div>
                                {Array.isArray(activeBuilding.rooms) && activeBuilding.rooms.length > 0 && (
                                    <div className="rooms-section">
                                        <div className="rooms-header">
                                            <button
                                                type="button"
                                                className="rooms-header-toggle"
                                                onClick={() => setRoomsExpanded((prev) => !prev)}
                                                aria-expanded={roomsExpanded}
                                            >
                                                <span>Rooms</span>
                                                <span className={`rooms-caret ${roomsExpanded ? 'open' : ''}`} aria-hidden="true">
                                                    >
                                                </span>
                                            </button>
                                            <span className="rooms-count">
                                                {activeBuilding.rooms.length} rooms
                                            </span>
                                        </div>
                                        <div
                                            className={`rooms-list-wrapper ${roomsExpanded ? 'expanded' : ''}`}
                                            aria-hidden={!roomsExpanded}
                                            style={{ '--rooms-height': `${roomsHeight}px` }}
                                        >
                                            {(() => {
                                                const floors = Array.from(
                                                    new Set(
                                                        activeBuilding.rooms
                                                            .map((room) => room.floor)
                                                            .filter((floor) => floor !== null && floor !== '')
                                                    )
                                                );
                                                const showFloor = floors.length > 1;
                                                const floorLabel = (floor) => {
                                                    if (floor === 0) return 'Basement';
                                                    if (floor === 1) return 'First Floor';
                                                    if (floor === 2) return 'Second Floor';
                                                    return `Floor ${floor}`;
                                                };
                                                const sortedRooms = [...activeBuilding.rooms].sort((a, b) => {
                                                    const aHasRate = a.rental_rate ? 1 : 0;
                                                    const bHasRate = b.rental_rate ? 1 : 0;
                                                    if (aHasRate !== bHasRate) return bHasRate - aHasRate;
                                                    const aFloor = a.floor === null || a.floor === '' ? -1 : Number(a.floor);
                                                    const bFloor = b.floor === null || b.floor === '' ? -1 : Number(b.floor);
                                                    if (aFloor !== bFloor) return bFloor - aFloor;
                                                    return (a.name || '').localeCompare(b.name || '');
                                                });
                                                return (
                                                    <div className="rooms-list" ref={roomsListRef}>
                                                        {sortedRooms.map((room) => (
                                                            <div key={room.id} className="room-row">
                                                                <div>
                                                                    <div className="room-name">{room.name}</div>
                                                                    <div className="room-meta">
                                                                        {showFloor && room.floor !== null && room.floor !== '' ? (
                                                                            <span>{floorLabel(room.floor)}</span>
                                                                        ) : null}
                                                                        {room.capacity ? <span>{room.capacity} seats</span> : null}
                                                                    </div>
                                                                </div>
                                                                {room.rental_rate ? (
                                                                    <span className="room-rate">{formatCurrency(room.rental_rate)}</span>
                                                                ) : null}
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {activeAreaTickets.length > 0 && (
                            <div className="map-ticket-section">
                                <h4>Active Tickets</h4>
                                <div className="map-ticket-list">
                                    {activeAreaTickets.map((ticket) => (
                                        <button
                                            key={ticket.id}
                                            type="button"
                                            className="map-ticket-button"
                                            onClick={() => focusTicket(ticket.id)}
                                        >
                                            <div className="map-ticket-header">
                                                <h5>{ticket.title}</h5>
                                                <span className={`ticket-status status-${ticket.status}`}>
                                                    {ticket.status.replace('_', ' ')}
                                                </span>
                                            </div>
                                            <p>{ticket.description || 'No description'}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </Card>
        </div>
    </Card>
);

export default BuildingsMap;
