/**
 * Shared task progress utilities used across Todo, Dashboard, Calendar, and Buildings.
 */

export {
    getSortedProgressSteps,
    getTaskProgressMeta
} from '../../shared/taskProgress.js';

import { getTaskProgressMeta } from '../../shared/taskProgress.js';

export const getTaskProgressLabel = (task) => {
    const meta = getTaskProgressMeta(task);
    if (!meta) return task?.completed ? 'Done' : 'Open';
    return meta.currentLabel || 'Not Started';
};

export const getTaskNextStepLabel = (task) => {
    const meta = getTaskProgressMeta(task);
    if (!meta) return task?.text || 'Next step';
    return meta.nextLabel || (meta.isComplete ? 'Complete' : 'Next');
};

export const getTaskActionLabel = (task, { progressiveFallback = 'Advance', completeLabel = 'Complete' } = {}) => {
    const meta = getTaskProgressMeta(task);
    if (!meta) {
        return task?.completed ? 'Undo' : completeLabel;
    }
    if (meta.currentIndex < 0 && meta.nextStep) return 'Start';
    if (meta.nextStep && String(meta.nextStep.title || '').trim().toLowerCase() === 'done') {
        return 'Mark Done';
    }
    if (meta.nextStep) return progressiveFallback;
    return completeLabel;
};
