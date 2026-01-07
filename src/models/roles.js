export const ROLE_DEFINITIONS = [
    { key: 'celebrant', label: 'Celebrant', tags: ['clergy'] },
    { key: 'preacher', label: 'Preacher', tags: ['clergy'] },
    { key: 'officiant', label: 'Officiant', tags: ['clergy'] },
    { key: 'lector', label: 'Lector', tags: ['reader', 'volunteer'] },
    { key: 'lem', label: 'LEM', tags: ['lay eucharistic minister', 'volunteer'] },
    { key: 'acolyte', label: 'Acolyte', tags: ['altar server', 'volunteer'] },
    { key: 'thurifer', label: 'Thurifer', tags: ['volunteer'] },
    { key: 'usher', label: 'Usher', tags: ['hospitality', 'volunteer'] },
    { key: 'altarGuild', label: 'Altar Guild', tags: ['worship', 'volunteer'] },
    { key: 'choirmaster', label: 'Choirmaster', tags: ['music', 'staff'] },
    { key: 'organist', label: 'Organist', tags: ['music', 'staff'] },
    { key: 'sound', label: 'Sound Engineer', tags: ['tech', 'volunteer'] },
    { key: 'coffeeHour', label: 'Coffee Hour', tags: ['hospitality', 'volunteer'] },
    { key: 'buildingSupervisor', label: 'Building Supervisor', tags: ['facilities', 'staff'] },
    { key: 'childcare', label: 'Childcare', tags: ['staff'] }
];

export const ROLE_KEYS = ROLE_DEFINITIONS.map(role => role.key);

export const getRoleDefinition = (key) => ROLE_DEFINITIONS.find(role => role.key === key);
