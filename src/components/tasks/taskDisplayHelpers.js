export const getTaskPriorityClass = (task) => {
    const tier = String(task?.priority_tier || '').trim().toLowerCase();
    if (tier === 'critical') return 'priority-critical';
    if (tier === 'high') return 'priority-high';
    if (tier === 'low') return 'priority-low';
    if (tier === 'someday') return 'priority-someday';
    return 'priority-normal';
};

export const getTaskPriorityLabel = (task) => {
    const tier = String(task?.priority_tier || 'normal').trim().toLowerCase() || 'normal';
    return tier.charAt(0).toUpperCase() + tier.slice(1);
};

export const isTaskBlocked = (task) => (
    Boolean(Number(task?.blocked)) || String(task?.instance_state || '').trim().toLowerCase() === 'blocked'
);
