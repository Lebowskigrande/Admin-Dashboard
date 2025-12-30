export const ROLE_DEFINITIONS = [
    { key: 'celebrant', label: 'Celebrant', tags: ['clergy'] },
    { key: 'deacon', label: 'Deacon', tags: ['clergy'] },
    { key: 'lector', label: 'Lector', tags: ['reader', 'volunteer'] },
    { key: 'chaliceBearer', label: 'LEM / Chalice Bearer', tags: ['lay eucharistic minister', 'volunteer'] },
    { key: 'acolyte', label: 'Acolyte', tags: ['altar server', 'volunteer'] },
    { key: 'usher', label: 'Usher', tags: ['hospitality', 'volunteer'] },
    { key: 'greeter', label: 'Greeter', tags: ['hospitality', 'volunteer'] },
    { key: 'sound', label: 'Sound', tags: ['tech', 'volunteer'] },
    { key: 'coffeeHour', label: 'Coffee Hour', tags: ['hospitality', 'volunteer'] }
];

export const ROLE_KEYS = ROLE_DEFINITIONS.map(role => role.key);

export const getRoleDefinition = (key) => ROLE_DEFINITIONS.find(role => role.key === key);
