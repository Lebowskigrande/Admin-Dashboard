import { routeShareFileEmails } from './sharefileEmailRouter.js';

export const startSharefilePoller = () => {
    const sharefilePollingEnabled = String(process.env.SHAREFILE_ROUTER_ENABLED || '0') === '1';
    const sharefilePollingMs = Number(process.env.SHAREFILE_ROUTER_INTERVAL_MS) || 30 * 1000;
    const unprocessedDonationsLabel = String(
        process.env.SHAREFILE_UNPROCESSED_DONATIONS_LABEL || 'Unprocessed donations'
    ).trim();
    if (!sharefilePollingEnabled) {
        return null;
    }

    const runSharefilePoll = async () => {
        try {
            await routeShareFileEmails({
                archive: false,
                searchLabel: unprocessedDonationsLabel,
                removeLabelOnSuccess: unprocessedDonationsLabel,
                includeAlreadyProcessed: false,
                requireContribution: true
            });
        } catch (error) {
            console.error('ShareFile email router error:', error);
        }
    };

    runSharefilePoll();
    const timer = setInterval(runSharefilePoll, sharefilePollingMs);
    return timer;
};
