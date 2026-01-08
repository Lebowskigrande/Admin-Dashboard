const STORAGE_KEY = 'vestry-details';

const defaultDetails = {
    committeeMeetings: [],
    checklistProgress: {}
};

export const getVestryDetails = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultDetails };
    try {
        return { ...defaultDetails, ...JSON.parse(raw) };
    } catch {
        return { ...defaultDetails };
    }
};

export const saveVestryDetails = (details) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(details));
};
