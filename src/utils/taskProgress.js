/**
 * Shared task progress utilities used across Todo, Dashboard, Calendar, and Buildings.
 */

export const getSortedProgressSteps = (task) => {
    const steps = Array.isArray(task?.progress_steps) ? task.progress_steps : [];
    return steps.slice().sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0));
};

export const getTaskProgressMeta = (task) => {
    const listMode = String(task?.list_mode || '').toLowerCase();
    if (listMode !== 'progressive') return null;
    const steps = getSortedProgressSteps(task);
    if (!steps.length) return null;
    const currentKey = String(task?.progress_key || '');
    const currentIndex = steps.findIndex((step) => step.key === currentKey);
    const currentStep = currentIndex >= 0 ? steps[currentIndex] : null;
    const nextStep = currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;
    const prevStep = currentIndex > 0 ? steps[currentIndex - 1] : null;
    const currentLabel = currentStep ? currentStep.title : 'Not Started';
    const nextLabel = nextStep ? nextStep.title : 'Complete';
    const isComplete = currentIndex >= steps.length - 1 && currentIndex >= 0;
    return {
        steps,
        currentIndex,
        currentStep,
        prevStep,
        nextStep,
        currentLabel,
        nextLabel,
        isComplete
    };
};

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
