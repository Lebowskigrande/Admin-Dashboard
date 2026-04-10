import { createElement } from 'react';
import {
    FaArrowDown,
    FaArrowUp,
    FaBirthdayCake,
    FaCalendarCheck,
    FaClipboardList,
    FaDollarSign,
    FaEnvelope,
    FaMailBulk,
    FaFileAlt,
    FaLayerGroup,
    FaLandmark,
    FaMusic,
    FaBoxes,
    FaTools,
    FaUsers,
    FaUtensils
} from 'react-icons/fa';

const MoneyArrowIcon = ({ direction = 'down' }) => {
    const Arrow = direction === 'up' ? FaArrowUp : FaArrowDown;
    return createElement(
        'span',
        { className: `money-arrow-icon direction-${direction}`, 'aria-hidden': 'true' },
        createElement(FaDollarSign),
        createElement(Arrow, { className: 'money-arrow-glyph' })
    );
};

const ReceivablesIcon = () => createElement(MoneyArrowIcon, { direction: 'down' });
const PayablesIcon = () => createElement(MoneyArrowIcon, { direction: 'up' });

const SECTION_ICON_MAP = {
    documents: FaFileAlt,
    people: FaUsers,
    music: FaMusic,
    setup: FaTools,
    communications: FaEnvelope,
    mail: FaMailBulk,
    birthday: FaBirthdayCake,
    followup: FaCalendarCheck,
    hospitality: FaUtensils,
    finance: FaDollarSign,
    orders: FaBoxes,
    deposits: FaLandmark,
    receivables: ReceivablesIcon,
    payables: PayablesIcon,
    general: FaClipboardList
};

export const getSectionIconComponent = (iconKey) => SECTION_ICON_MAP[iconKey] || FaLayerGroup;
