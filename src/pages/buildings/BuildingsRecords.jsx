import { useMemo, useState } from 'react';
import Card from '../../components/Card';
import { API_URL } from '../../services/apiConfig';

const normalize = (value) => String(value || '').toLowerCase().trim();

const unique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const utilityLayerTokens = ['electrical', 'plumbing', 'mechanical', 'hvac', 'life safety', 'low voltage', 'lighting', 'power'];

const isUtilityLayer = (layer = '') => utilityLayerTokens.some((token) => normalize(layer).includes(token));

const formatRecordMeta = (record) => {
    const bits = [];
    if (record.year) bits.push(record.year);
    if (record.pageCount) bits.push(`${record.pageCount} page${record.pageCount === 1 ? '' : 's'}`);
    return bits.join(' \u2022 ');
};

const BuildingsRecords = ({
    recordsOverview,
    recordsLoading,
    recordsError,
    mapAreas,
    areaById,
    setActiveTab,
    setActiveArea
}) => {
    const [query, setQuery] = useState('');
    const [layerFilter, setLayerFilter] = useState('all');
    const [systemFilter, setSystemFilter] = useState('all');
    const [areaFilter, setAreaFilter] = useState('all');
    const [utilityOnly, setUtilityOnly] = useState(false);

    const records = useMemo(() => (Array.isArray(recordsOverview.records) ? recordsOverview.records : []), [recordsOverview.records]);
    const layers = useMemo(() => (Array.isArray(recordsOverview.layers) ? recordsOverview.layers : []), [recordsOverview.layers]);
    const systems = useMemo(() => (Array.isArray(recordsOverview.systems) ? recordsOverview.systems : []), [recordsOverview.systems]);
    const areas = useMemo(() => (Array.isArray(recordsOverview.areas) ? recordsOverview.areas : []), [recordsOverview.areas]);
    const summary = recordsOverview.summary || recordsOverview.stats || {};

    const areaOptions = useMemo(() => {
        const seen = new Map();
        areas.forEach((area) => {
            const sourceId = String(area.id || area.key || area.label || '').trim();
            const label = String(area.label || area.name || sourceId || 'Unassigned').trim();
            if (!sourceId && !label) return;
            const key = normalize(sourceId || label);
            if (!seen.has(key)) {
                seen.set(key, {
                    id: sourceId || key,
                    label,
                    count: Number(area.count || 0)
                });
            }
        });
        mapAreas.forEach((area) => {
            if (area.type !== 'building') return;
            const key = normalize(area.id || area.name);
            if (!seen.has(key)) {
                seen.set(key, { id: area.id, label: area.name, count: area.architecturalRecordCount || 0 });
            }
        });
        return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [areas, mapAreas]);

    const filteredRecords = useMemo(() => {
        const tokens = normalize(query).split(/\s+/).filter(Boolean);
        return records.filter((record) => {
            const haystack = [
                record.title,
                record.fileName,
                record.summary,
                record.notes,
                record.layerLabel,
                ...(record.utilitySystems || []),
                ...(record.areaNames || []),
                record.areaName,
                ...(record.keywords || [])
            ].map((value) => normalize(value)).join(' ');
            const matchesQuery = tokens.length === 0 || tokens.every((token) => haystack.includes(token));
            const matchesLayer = layerFilter === 'all' || normalize(record.layerLabel || record.layer) === normalize(layerFilter);
            const recordAreaTokens = unique([
                ...(record.areaIds || []),
                ...(record.areaNames || []),
                record.areaId,
                record.areaName,
                record.buildingId,
                record.buildingName
            ]);
            const matchesArea = areaFilter === 'all' || recordAreaTokens.some((token) => normalize(token) === normalize(areaFilter));
            const recordSystemTokens = unique([
                ...(record.utilitySystems || []),
                record.utilityLabel
            ]);
            const matchesSystem = systemFilter === 'all' || recordSystemTokens.some((token) => normalize(token) === normalize(systemFilter));
            const matchesUtility = !utilityOnly || isUtilityLayer(record.layerLabel || record.layer || record.utilityCategory);
            return matchesQuery && matchesLayer && matchesArea && matchesSystem && matchesUtility;
        }).sort((a, b) => String(b.year || 0).localeCompare(String(a.year || 0)) || String(a.title || '').localeCompare(String(b.title || '')));
    }, [areaFilter, layerFilter, query, records, systemFilter, utilityOnly]);

    const focusArea = (record) => {
        const areaIds = unique([
            ...(record.areaIds || []),
            record.areaId,
            record.buildingId,
            record.buildingName,
            record.areaName
        ]);
        const target = areaIds
            .map((areaId) => mapAreas.find((area) => area.id === areaId) || mapAreas.find((area) => normalize(area.name) === normalize(areaId)))
            .find(Boolean);
        if (!target) return;
        setActiveArea(target);
        setActiveTab('map');
    };

    const openDocument = (record) => {
        const url = record.downloadUrl
            ? `${API_URL}${record.downloadUrl}`
            : record.openPath
                ? `${API_URL}/files/download?path=${encodeURIComponent(record.openPath)}`
                : '';
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const openLocation = async (record) => {
        const targetPath = record.openPath || record.absolutePath || record.filePath;
        if (!targetPath) return;
        try {
            await fetch(`${API_URL}/files/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: targetPath })
            });
        } catch (error) {
            console.error('Failed to open record location:', error);
        }
    };

    if (recordsLoading) {
        return (
            <Card className="architectural-records-card">
                <p className="code-lookup-empty">Loading architectural records...</p>
            </Card>
        );
    }

    return (
        <div className="architectural-records-layout">
            <Card className="architectural-records-card">
                <div className="architectural-records-header">
                    <div>
                        <p className="page-header-kicker">B&G Archive</p>
                        <h2>Architectural Records</h2>
                        <p>Browse sheets, utility layers, and file-to-building associations from the 2013 archive.</p>
                    </div>
                    <button type="button" className="code-lookup-detail-btn" onClick={() => setActiveTab('map')}>
                        Back to map
                    </button>
                </div>

                {recordsError ? <div className="map-note">{recordsError}</div> : null}

                <div className="budget-summary-grid architectural-summary-grid">
                    <div className="budget-summary-card">
                        <span>Records indexed</span>
                        <strong>{summary.recordCount ?? records.length}</strong>
                    </div>
                    <div className="budget-summary-card">
                        <span>Layers</span>
                        <strong>{summary.layerCount ?? layers.length}</strong>
                    </div>
                    <div className="budget-summary-card">
                        <span>Areas linked</span>
                        <strong>{summary.areaCount ?? areaOptions.length}</strong>
                    </div>
                    <div className="budget-summary-card">
                        <span>Systems tracked</span>
                        <strong>{summary.systemCount ?? systems.length}</strong>
                    </div>
                </div>

                <div className="architectural-filter-bar">
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search sheet title, file name, notes, or keywords..."
                        className="code-lookup-search"
                    />
                    <label className="architectural-toggle">
                        <input
                            type="checkbox"
                            checked={utilityOnly}
                            onChange={(event) => setUtilityOnly(event.target.checked)}
                        />
                        Utilities only
                    </label>
                </div>

                <div className="architectural-chip-row">
                    <button
                        type="button"
                        className={layerFilter === 'all' ? 'is-active' : ''}
                        onClick={() => setLayerFilter('all')}
                    >
                        All layers
                    </button>
                    {layers.map((layer) => (
                        <button
                            key={layer.key || layer.id || layer.label}
                            type="button"
                            className={normalize(layerFilter) === normalize(layer.label) ? 'is-active' : ''}
                            onClick={() => setLayerFilter(layer.label)}
                        >
                            {layer.label}
                            <span>{layer.count || 0}</span>
                        </button>
                    ))}
                </div>

                <div className="architectural-chip-row secondary">
                    <button
                        type="button"
                        className={areaFilter === 'all' ? 'is-active' : ''}
                        onClick={() => setAreaFilter('all')}
                    >
                        All areas
                    </button>
                    {areaOptions.map((area) => (
                        <button
                            key={area.id}
                            type="button"
                            className={normalize(areaFilter) === normalize(area.id) ? 'is-active' : ''}
                            onClick={() => setAreaFilter(area.id)}
                        >
                            {area.label}
                            {area.count ? <span>{area.count}</span> : null}
                        </button>
                    ))}
                </div>

                <div className="architectural-chip-row secondary">
                    <button
                        type="button"
                        className={systemFilter === 'all' ? 'is-active' : ''}
                        onClick={() => setSystemFilter('all')}
                    >
                        All systems
                    </button>
                    {systems.map((system) => (
                        <button
                            key={system.key || system.id || system.label}
                            type="button"
                            className={normalize(systemFilter) === normalize(system.id) ? 'is-active' : ''}
                            onClick={() => setSystemFilter(system.id)}
                        >
                            {system.label}
                            {system.count ? <span>{system.count}</span> : null}
                        </button>
                    ))}
                </div>
            </Card>

            <div className="architectural-records-grid">
                <Card className="architectural-records-list-card">
                    <div className="architectural-section-header">
                        <div>
                            <h3>Quick Documents</h3>
                            <p>{filteredRecords.length} matching records</p>
                        </div>
                    </div>
                    <div className="architectural-record-list">
                        {filteredRecords.length > 0 ? filteredRecords.map((record) => {
                            const areaLabel = record.areaName || record.buildingName || record.areaId || record.buildingId || 'Unassigned';
                            const areaRef = (record.areaIds || []).map((id) => areaById[id]?.name || id).filter(Boolean);
                            const meta = formatRecordMeta(record);
                            return (
                                <article key={record.id} className="architectural-record-item">
                                    <div className="architectural-record-topline">
                                        <div>
                                            <h4>{record.title}</h4>
                                            <p>{record.summary || record.notes || record.fileName || 'No summary available.'}</p>
                                        </div>
                                        <div className="architectural-record-actions">
                                            <button type="button" className="architectural-record-link" onClick={() => focusArea(record)}>
                                                View on map
                                            </button>
                                            {(record.downloadUrl || record.openPath) ? (
                                                <button type="button" className="architectural-record-link secondary" onClick={() => openDocument(record)}>
                                                    Open
                                                </button>
                                            ) : null}
                                            {(record.openPath || record.absolutePath || record.filePath) ? (
                                                <button type="button" className="architectural-record-link secondary" onClick={() => openLocation(record)}>
                                                    Reveal
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="architectural-record-badges">
                                        <span className="pill">{record.layerLabel || record.layer || 'General'}</span>
                                        {(record.utilitySystems || []).slice(0, 2).map((system) => (
                                            <span key={system} className="pill map-category map-category-all-purpose">{system}</span>
                                        ))}
                                        <span className="pill">{areaLabel}</span>
                                        {meta ? <span className="pill">{meta}</span> : null}
                                    </div>
                                    {unique([...(record.areaNames || []), ...areaRef]).length > 0 ? (
                                        <div className="architectural-record-associations">
                                            <span>Linked areas</span>
                                            <div className="architectural-record-tags">
                                                {unique([...(record.areaNames || []), ...areaRef]).slice(0, 4).map((label) => (
                                                    <span key={label} className="architectural-record-tag">{label}</span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </article>
                            );
                        }) : (
                            <p className="code-lookup-empty">No architectural records match the current filters.</p>
                        )}
                    </div>
                </Card>

                <Card className="architectural-records-sidebar">
                    <div className="architectural-section-header">
                        <div>
                            <h3>Systems Focus</h3>
                            <p>Utility and drawing systems at a glance.</p>
                        </div>
                    </div>
                    <div className="architectural-focus-list">
                        {systems.filter((system) => isUtilityLayer(system.label)).map((system) => (
                            <button
                                key={system.key || system.label}
                                type="button"
                                className="architectural-focus-item"
                                onClick={() => setSystemFilter(system.id)}
                            >
                                <strong>{system.label}</strong>
                                <span>{system.count || 0} sheets</span>
                            </button>
                        ))}
                        {layers.filter((layer) => isUtilityLayer(layer.label)).map((layer) => (
                            <button
                                key={layer.key || layer.label}
                                type="button"
                                className="architectural-focus-item"
                                onClick={() => setLayerFilter(layer.label)}
                            >
                                <strong>{layer.label}</strong>
                                <span>{layer.count || 0} sheets</span>
                            </button>
                        ))}
                        {layers.filter((layer) => !isUtilityLayer(layer.label)).slice(0, 8).map((layer) => (
                            <button
                                key={layer.key || layer.label}
                                type="button"
                                className="architectural-focus-item secondary"
                                onClick={() => setLayerFilter(layer.label)}
                            >
                                <strong>{layer.label}</strong>
                                <span>{layer.count || 0} sheets</span>
                            </button>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default BuildingsRecords;
