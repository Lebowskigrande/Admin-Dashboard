import { buildOriginGroups } from '../../shared/taskRollups.js';
import { sortTasksByPriority } from '../helpers/task-utils.js';

export const buildOriginRollups = (tasks = []) => (
    buildOriginGroups(tasks, { sortTasks: sortTasksByPriority }).map((group) => ({
        key: group.key,
        origin_type: group.origin_type,
        origin_id: group.origin_id,
        total_count: group.totalCount,
        open_count: group.openCount,
        completed_count: group.completedCount,
        next_task: group.nextTask,
        sample: group.sample
    }))
);
