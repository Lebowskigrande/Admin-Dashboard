import {
    FaCalendarCheck,
    FaClipboardList,
    FaDollarSign,
    FaEnvelope,
    FaFileAlt,
    FaLayerGroup,
    FaMusic,
    FaTools,
    FaUsers,
    FaUtensils
} from 'react-icons/fa';

const SECTION_ICON_MAP = {
    documents: FaFileAlt,
    people: FaUsers,
    music: FaMusic,
    setup: FaTools,
    communications: FaEnvelope,
    followup: FaCalendarCheck,
    hospitality: FaUtensils,
    finance: FaDollarSign,
    general: FaClipboardList
};

export const getSectionIconComponent = (iconKey) => SECTION_ICON_MAP[iconKey] || FaLayerGroup;
