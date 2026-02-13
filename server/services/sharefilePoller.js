import { routeShareFileEmails } from './sharefileEmailRouter.js';

export const startSharefilePoller = () => {
    const sharefilePollingEnabled = String(process.env.SHAREFILE_ROUTER_ENABLED || '0') === '1';
    const sharefilePollingMs = Number(process.env.SHAREFILE_ROUTER_INTERVAL_MS) || 5 * 60 * 1000;

    if (!sharefilePollingEnabled) {
        return null;
    }

    const runSharefilePoll = async () => {
        try {
            await routeShareFileEmails({ archive: true });
        } catch (error) {
            console.error('ShareFile email router error:', error);
        }
    };

    runSharefilePoll();
    const timer = setInterval(runSharefilePoll, sharefilePollingMs);
    return timer;
};
