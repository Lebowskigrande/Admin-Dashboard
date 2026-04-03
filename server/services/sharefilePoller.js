import process from 'process';
import { access, readFile, rm, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

import { routeShareFileEmails } from './sharefileEmailRouter.js';

const POLLER_LOCK_PATH = join(process.cwd(), 'server', '.sharefile-poller.lock');
let activePoller = null;

const defaultDonationLabels = ['Unprocessed donation', 'Unprocessed donations'];

const getDonationLabels = () => {
    const configured = String(process.env.SHAREFILE_UNPROCESSED_DONATIONS_LABEL || '').trim();
    const labels = configured
        ? [configured]
        : [...defaultDonationLabels];

    if (configured.toLowerCase() === 'unprocessed donation') {
        labels.push('Unprocessed donations');
    } else if (configured.toLowerCase() === 'unprocessed donations') {
        labels.push('Unprocessed donation');
    }

    return Array.from(new Set(labels.map((label) => String(label || '').trim()).filter(Boolean)));
};

const canUsePid = async (pid) => {
    const normalized = Number(pid);
    if (!Number.isInteger(normalized) || normalized <= 0) return false;
    try {
        process.kill(normalized, 0);
        return true;
    } catch {
        return false;
    }
};

const acquirePollerLock = async () => {
    const payload = JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString()
    });

    try {
        await writeFile(POLLER_LOCK_PATH, payload, { flag: 'wx' });
        return true;
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }
    }

    try {
        await access(POLLER_LOCK_PATH, fsConstants.F_OK);
        const raw = await readFile(POLLER_LOCK_PATH, 'utf8');
        const existing = JSON.parse(String(raw || '{}'));
        if (await canUsePid(existing?.pid)) {
            return false;
        }
    } catch {
        // Ignore malformed or stale lock content and replace it below.
    }

    await rm(POLLER_LOCK_PATH, { force: true });
    await writeFile(POLLER_LOCK_PATH, payload, { flag: 'wx' });
    return true;
};

const releasePollerLock = async () => {
    try {
        const raw = await readFile(POLLER_LOCK_PATH, 'utf8');
        const existing = JSON.parse(String(raw || '{}'));
        if (Number(existing?.pid) === process.pid) {
            await rm(POLLER_LOCK_PATH, { force: true });
        }
    } catch {
        // ignore cleanup failures during shutdown
    }
};

export const startSharefilePoller = async () => {
    if (activePoller) {
        return activePoller;
    }

    const sharefilePollingEnabled = String(process.env.SHAREFILE_ROUTER_ENABLED || '0') === '1';
    const sharefilePollingMs = Number(process.env.SHAREFILE_ROUTER_INTERVAL_MS) || 30 * 1000;
    const donationLabels = getDonationLabels();
    if (!sharefilePollingEnabled) {
        return null;
    }

    const lockAcquired = await acquirePollerLock().catch((error) => {
        console.error('Failed to acquire ShareFile poller lock:', error);
        return false;
    });
    if (!lockAcquired) {
        console.log('ShareFile poller already running in another process');
        return null;
    }

    let running = false;
    const runSharefilePoll = async () => {
        if (running) return;
        running = true;
        try {
            for (const label of donationLabels) {
                await routeShareFileEmails({
                    archive: false,
                    searchLabel: label,
                    removeLabelOnSuccess: label,
                    includeAlreadyProcessed: false,
                    requireContribution: true
                });
            }
        } catch (error) {
            console.error('ShareFile email router error:', error);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(() => {
        void runSharefilePoll();
    }, sharefilePollingMs);
    const stop = async () => {
        clearInterval(timer);
        activePoller = null;
        await releasePollerLock();
    };

    process.once('exit', () => {
        void releasePollerLock();
    });
    process.once('SIGINT', () => {
        void stop();
    });
    process.once('SIGTERM', () => {
        void stop();
    });

    activePoller = { timer, stop, labels: donationLabels };
    void runSharefilePoll();
    return activePoller;
};
