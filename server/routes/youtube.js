import express from 'express';
import { sqlite as db } from '../db.js';
import { tableExists, parseNotes } from '../helpers/db-utils.js';

const router = express.Router();
const YOUTUBE_TIMEZONE = process.env.YOUTUBE_TIMEZONE || 'America/Los_Angeles';

const formatYoutubeDate = (isoString) => {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: YOUTUBE_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
};

const fetchUpcomingStreams = async (apiKey, channelId) => {
    const searchParams = new URLSearchParams({
        part: 'id',
        channelId,
        eventType: 'upcoming',
        type: 'video',
        order: 'date',
        maxResults: '10',
        key: apiKey
    });
    const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`);
    if (!searchResponse.ok) {
        throw new Error('Failed to fetch YouTube stream list');
    }
    const searchData = await searchResponse.json();
    const videoIds = (searchData.items || [])
        .map((item) => item?.id?.videoId)
        .filter(Boolean);
    if (!videoIds.length) return [];

    const videosParams = new URLSearchParams({
        part: 'snippet,liveStreamingDetails',
        id: videoIds.join(','),
        key: apiKey
    });
    const videosResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videosParams.toString()}`);
    if (!videosResponse.ok) {
        throw new Error('Failed to fetch YouTube stream details');
    }
    const videosData = await videosResponse.json();
    return (videosData.items || []).map((item) => {
        const scheduled = item?.liveStreamingDetails?.scheduledStartTime || '';
        return {
            videoId: item.id,
            title: item?.snippet?.title || 'Upcoming Livestream',
            scheduledStartTime: scheduled,
            scheduledDate: scheduled ? formatYoutubeDate(scheduled) : '',
            url: `https://www.youtube.com/watch?v=${item.id}`
        };
    }).filter((item) => item.scheduledDate);
};

// parseNotes moved to db-utils.js

const syncLivestreamsToSundays = (streams) => {
    if (!tableExists('event_occurrences')) {
        return 0;
    }
    const update = db.prepare('UPDATE event_occurrences SET notes = ? WHERE id = ?');
    const findOccurrence = db.prepare(`
        SELECT id, notes FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = '10:00'
    `);
    let updated = 0;
    streams.forEach((stream) => {
        const occurrence = findOccurrence.get(stream.scheduledDate);
        if (!occurrence) return;
        const notes = parseNotes(occurrence.notes);
        notes.youtubeUrl = stream.url;
        notes.youtubeTitle = stream.title;
        notes.youtubeVideoId = stream.videoId;
        notes.youtubeScheduledStart = stream.scheduledStartTime;
        update.run(JSON.stringify(notes), occurrence.id);
        updated += 1;
    });
    return updated;
};

// Auto-schedule setup
// Note: This side-effect needs to be handled carefully. 
// Maybe export a function to start the scheduler?
export const startYouTubeScheduler = () => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) return;

    const runSync = async () => {
        try {
            const streams = await fetchUpcomingStreams(apiKey, channelId);
            syncLivestreamsToSundays(streams);
            const nextScheduled = streams
                .map((stream) => new Date(stream.scheduledStartTime).getTime())
                .filter((ts) => Number.isFinite(ts))
                .sort((a, b) => a - b)[0];
            if (nextScheduled) {
                const delay = Math.max(nextScheduled - Date.now() + 2 * 60 * 1000, 5 * 60 * 1000);
                setTimeout(runSync, delay);
                return;
            }
        } catch (error) {
            console.error('YouTube auto-sync error:', error);
        }
        setTimeout(runSync, 60 * 60 * 1000);
    };

    runSync();
};

router.get('/api/youtube/upcoming', async (req, res) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) {
        return res.status(400).json({ error: 'Missing YouTube API configuration' });
    }
    try {
        const streams = await fetchUpcomingStreams(apiKey, channelId);
        res.json(streams);
    } catch (error) {
        console.error('YouTube API error:', error);
        return res.status(500).json({ error: 'Failed to fetch livestream' });
    }
});

router.post('/api/youtube/sync', async (req, res) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) {
        return res.status(400).json({ error: 'Missing YouTube API configuration' });
    }
    try {
        const streams = await fetchUpcomingStreams(apiKey, channelId);
        const synced = syncLivestreamsToSundays(streams);
        res.json({ success: true, synced });
    } catch (error) {
        console.error('YouTube sync error:', error);
        res.status(500).json({ error: 'Failed to sync livestreams' });
    }
});

export default router;
