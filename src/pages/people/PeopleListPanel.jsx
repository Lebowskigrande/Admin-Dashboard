import { CATEGORY_LABELS } from './peopleHelpers';
import { formatPhone } from '../../utils/formatters';

const PeopleListPanel = ({
    people,
    filteredPeople,
    loading,
    selectedId,
    onSelectPerson
}) => (
    <div className="people-panel people-list-panel">
        <div className="panel-title--row">
            <h2 className="panel-title">Directory</h2>
            <span className="panel-meta">
                {filteredPeople.length} of {people.length}
            </span>
        </div>
        {loading ? (
            <div className="people-loading">Loading people...</div>
        ) : filteredPeople.length === 0 ? (
            <div className="empty-card">No people match the current filters.</div>
        ) : (
            <div className="people-list">
                {filteredPeople.map((person) => (
                    <button
                        className={`people-list-item ${person.id === selectedId ? 'active' : ''}`}
                        key={person.id}
                        type="button"
                        onClick={() => onSelectPerson(person)}
                    >
                        <div className="people-list-row">
                            <div className="people-list-cell people-list-env">
                                {(() => {
                                    const envelopeTag = (person.tags || []).find((tag) => /^env-\d+/i.test(tag));
                                    if (!envelopeTag) return null;
                                    const label = envelopeTag.replace(/^env-/i, '');
                                    return <span className="env-chip env-chip--list">{label}</span>;
                                })()}
                            </div>
                            <div className="people-list-cell people-list-name">
                                <span>{person.displayName}</span>
                            </div>
                            <div className="people-list-cell people-list-email">
                                {person.email || ''}
                            </div>
                            <div className="people-list-cell people-list-phone">
                                {formatPhone(person.phonePrimary || person.phoneAlternate || '')}
                            </div>
                            <div className="people-list-cell people-list-category">
                                {person.category && (
                                    <span className={`category-chip category-${person.category}`}>
                                        {CATEGORY_LABELS[person.category] || person.category}
                                    </span>
                                )}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        )}
    </div>
);

export default PeopleListPanel;
