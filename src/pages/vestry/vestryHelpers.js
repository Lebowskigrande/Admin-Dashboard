import { ROLE_DEFINITIONS } from '../../models/roles';

export const BASE_PACKET_DOCS = [
    { id: 'agenda', label: 'Agenda', required: true },
    { id: 'minutes', label: 'Previous Minutes', required: true },
    { id: 'treasurer', label: 'Treasurer Report', required: true },
    { id: 'church-financials', label: 'Church Financials (P&L, BS, Ledger, Pledges)', required: true },
    { id: 'school-pl', label: 'School P&L', required: true },
    { id: 'school-bs', label: 'School Balance Sheet', required: true }
];

const getNthThursday = (year, month, nth) => {
    const first = new Date(year, month, 1);
    const day = first.getDay();
    const offset = (4 - day + 7) % 7;
    const date = 1 + offset + (nth - 1) * 7;
    return new Date(year, month, date);
};

export const getVestryMeetingDate = (year, month) => {
    const nth = (month === 10 || month === 11) ? 3 : 4;
    return getNthThursday(year, month, nth);
};

export const normalizeChecklistPhase = (phase) => {
    const raw = String(phase || '').toLowerCase();
    if (!raw) return 'Other';
    if (raw.includes('pre')) return 'Pre-Vestry';
    if (raw.includes('post')) return 'Post-Vestry';
    if (raw.includes('package') || raw.includes('packet')) return 'Vestry Package';
    return phase || 'Other';
};

export const getQuarterLabel = (meetingDate) => {
    const baseDate = meetingDate || new Date();
    const previousMonth = (baseDate.getMonth() + 11) % 12;
    const quarterIndex = Math.floor(previousMonth / 3);
    return ['Q1', 'Q2', 'Q3', 'Q4'][quarterIndex] || 'Q1';
};

export const buildDefaultReasons = (quarterLabel) => ({
    fundA: {
        monthlyReason: "20% of Associate Rector's salary",
        interestReason: `Interest earned in ${quarterLabel}`
    },
    fundB: {
        monthlyReason: '50% of shared expenses',
        interestReason: `Interest earned in ${quarterLabel}`
    },
    fidelity: {
        interestReason: `Interest earned in ${quarterLabel}`
    }
});

export const roleLabel = (key) => ROLE_DEFINITIONS.find((role) => role.key === key)?.label || key;
