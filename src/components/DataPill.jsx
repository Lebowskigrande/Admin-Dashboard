import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const buildLabel = (type, value, role) => {
    const typeLabel = type ? type.replace(/_/g, ' ') : 'item';
    if (role) {
        return `${typeLabel}: ${value} · ${role}`;
    }
    return `${typeLabel}: ${value}`;
};

const DataPill = ({
    type = 'item',
    value = '',
    role = '',
    tooltip,
    label,
    showType = true,
    onClick,
    actions = [],
    className = ''
}) => {
    const [menu, setMenu] = useState(null);
    const pillClass = useMemo(
        () => `data-pill data-pill--${type}${className ? ` ${className}` : ''}`,
        [type, className]
    );
    const fallbackLabel = showType ? buildLabel(type, value, role) : String(value || '');
    const displayLabel = label || fallbackLabel;
    const resolvedTooltip = tooltip || displayLabel || fallbackLabel;

    useEffect(() => {
        const handleClose = (event) => {
            if (!menu) return;
            if (event.type === 'keydown' && event.key !== 'Escape') return;
            setMenu(null);
        };
        window.addEventListener('click', handleClose);
        window.addEventListener('keydown', handleClose);
        return () => {
            window.removeEventListener('click', handleClose);
            window.removeEventListener('keydown', handleClose);
        };
    }, [menu]);

    const handleContextMenu = (event) => {
        event.preventDefault();
        const builtActions = actions.length
            ? actions
            : [{
                label: 'Copy ID',
                onSelect: async () => {
                    if (value) {
                        await navigator.clipboard.writeText(String(value));
                    }
                }
            }];
        setMenu({
            x: event.clientX,
            y: event.clientY,
            actions: builtActions
        });
    };

    const renderMenu = () => {
        if (!menu) return null;
        return createPortal(
            <div
                className="data-pill-menu"
                style={{ top: `${menu.y}px`, left: `${menu.x}px` }}
                onContextMenu={(event) => event.preventDefault()}
            >
                {menu.actions.map((action) => (
                    <button
                        key={action.label}
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setMenu(null);
                            if (typeof action.onSelect === 'function') {
                                action.onSelect();
                            }
                        }}
                    >
                        {action.label}
                    </button>
                ))}
            </div>,
            document.body
        );
    };

    return (
        <>
            <button
                type="button"
                className={pillClass}
                title={resolvedTooltip}
                onClick={onClick}
                onContextMenu={handleContextMenu}
            >
                {displayLabel}
            </button>
            {renderMenu()}
        </>
    );
};

export default DataPill;
