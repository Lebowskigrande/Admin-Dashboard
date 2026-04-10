const SIMPLE_STATUS_LIST_KEYS = new Set([
    'bulletins',
    'bulletin',
    'bulletin8',
    'bulletin10',
    'insert',
    'documents',
    'contracts',
    'mail',
    'birthdays',
    'orders',
    'bills',
    'deposits',
    'donations',
    'timesheets',
    'payroll',
    'clergy',
    'people',
    'music',
    'setup',
    'logistics',
    'email',
    'communications',
    'comms'
]);

const SIMPLE_STATUS_LIST_TITLES = {
    bulletins: 'Bulletins',
    bulletin: 'Bulletin',
    bulletin8: 'Rite I Bulletin',
    bulletin10: 'Rite II Bulletin',
    insert: 'Insert',
    documents: 'Documents',
    contracts: 'Contracts',
    mail: 'Mail',
    birthdays: 'Birthday Cards',
    orders: 'Orders',
    bills: 'Payables',
    deposits: 'Deposits',
    donations: 'Receivables',
    timesheets: 'Payroll',
    payroll: 'Payroll',
    clergy: 'Clergy',
    people: 'People & Roles',
    music: 'Music',
    setup: 'Setup',
    logistics: 'Setup',
    email: 'Comms',
    communications: 'Comms',
    comms: 'Comms'
};

export const normalizeTaskListKey = (value) => String(value || '').trim().toLowerCase();

export const isSimpleStatusListKey = (value) => SIMPLE_STATUS_LIST_KEYS.has(normalizeTaskListKey(value));

export const getSimpleStatusListTitle = (listKey, fallback = '') => {
    const normalized = normalizeTaskListKey(listKey);
    return SIMPLE_STATUS_LIST_TITLES[normalized] || fallback || 'Task';
};

const resolveTaskState = (taskOrState) => {
    if (typeof taskOrState === 'string') return taskOrState;
    if (taskOrState?.completed || taskOrState?.completed_at || taskOrState?.state === 'done') return 'done';
    if (taskOrState?.state === 'blocked') return 'blocked';
    if (taskOrState?.state === 'in_progress') return 'in_progress';
    return 'open';
};

export const getTaskCycleState = (taskOrState) => resolveTaskState(taskOrState);

export const getNextTaskCycleState = (taskOrState) => {
    const state = resolveTaskState(taskOrState);
    if (state === 'done') return 'open';
    if (state === 'in_progress') return 'done';
    return 'in_progress';
};

export const getTaskCycleLabel = (taskOrState) => {
    const state = resolveTaskState(taskOrState);
    if (state === 'done') return 'Done';
    if (state === 'in_progress') return 'In progress';
    if (state === 'blocked') return 'Blocked';
    return 'Not started';
};

export const getTaskCycleChipText = (taskOrState) => {
    const state = resolveTaskState(taskOrState);
    if (state === 'done') return '\u2713';
    if (state === 'in_progress') return '...';
    if (state === 'blocked') return '!';
    return '';
};
