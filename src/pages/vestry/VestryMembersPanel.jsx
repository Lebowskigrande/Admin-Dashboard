import { useEffect, useState } from 'react';

import Card from '../../components/Card';
import { roleLabel } from './vestryHelpers';

const VestryMembersPanel = ({ vestryMembers, sortedVestryMembers }) => {
    const [openTooltipKey, setOpenTooltipKey] = useState(null);

    useEffect(() => {
        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-tooltip') || target.closest('.person-chip-wrapper')) return;
            setOpenTooltipKey(null);
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, []);

    const renderTooltipCard = (person) => {
        if (!person) return null;
        const tags = person.tags || [];
        const extensionTag = tags.find((tag) => tag.startsWith('ext-'));
        const phoneTag = tags.find((tag) => /^phone[:\-]/i.test(tag)) || tags.find((tag) => /^tel[:\-]/i.test(tag));
        const rawPhone = phoneTag ? phoneTag.replace(/^phone[:\-]\s*/i, '').replace(/^tel[:\-]\s*/i, '').trim() : '';
        const barePhoneTag = tags.find((tag) => !tag.startsWith('ext-') && /\d{3}[^0-9]?\d{3}[^0-9]?\d{4}/.test(tag || ''));
        const phoneLabel = rawPhone || barePhoneTag || (extensionTag ? `Ext ${extensionTag.replace(/^ext-/, '')}` : '');
        const titleTags = tags.filter((tag) => tag && tag !== extensionTag);
        const metaChips = [...titleTags, ...(extensionTag ? [extensionTag] : [])];

        return (
            <Card className="person-card tooltip-person-card">
                <div className="person-card__header">
                    <div className="person-main">
                        <div className="person-name">{person.displayName}</div>
                        {person.email && (
                            <a className="person-email" href={`mailto:${person.email}`}>
                                {person.email}
                            </a>
                        )}
                        {phoneLabel && (
                            <div className="person-phone">{phoneLabel}</div>
                        )}
                        {metaChips.length > 0 && (
                            <div className="meta-chip-row">
                                {metaChips.map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                        {tags.length > metaChips.length && (
                            <div className="tag-row">
                                {tags.filter((tag) => !metaChips.includes(tag)).map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="roles">
                    <span className="roles-label">Eligible roles</span>
                    <div className="role-chip-row">
                        {(person.roles || []).map((roleKey) => (
                            <span key={roleKey} className="role-chip">{roleLabel(roleKey)}</span>
                        ))}
                    </div>
                </div>
            </Card>
        );
    };

    return (
        <Card className="vestry-panel full-span vestry-members-panel">
            <div className="panel-header compact badge-corner">
                <span className="count-badge" aria-label={`${vestryMembers.length} vestry members`}>
                    {vestryMembers.length}
                </span>
            </div>
            <div className="pill-row">
                {vestryMembers.length === 0 ? (
                    <span className="text-muted">No vestry members assigned.</span>
                ) : (
                    sortedVestryMembers.map((member) => (
                        <span
                            key={member.id}
                            className={`person-chip-wrapper ${openTooltipKey === member.id ? 'tooltip-open' : ''}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenTooltipKey((prev) => (prev === member.id ? null : member.id));
                            }}
                        >
                            <span className={`person-chip person-chip-${member.category || 'volunteer'}`}>
                                {member.displayName}
                            </span>
                            <span className={`person-tooltip ${openTooltipKey === member.id ? 'open' : ''}`}>
                                {renderTooltipCard(member)}
                            </span>
                        </span>
                    ))
                )}
            </div>
        </Card>
    );
};

export default VestryMembersPanel;
