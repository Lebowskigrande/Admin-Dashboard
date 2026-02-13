export const uploadDropboxFile = async (token, path, bytes, mode = 'overwrite') => {
    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': JSON.stringify({
                path,
                mode,
                autorename: mode !== 'overwrite',
                mute: false
            })
        },
        body: bytes
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Dropbox upload failed');
    }
    return response.json().catch(() => ({}));
};

export const createOrGetDropboxSharedLink = async (token, path) => {
    const listResponse = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path, direct_only: true })
    });
    if (listResponse.ok) {
        const payload = await listResponse.json().catch(() => ({}));
        const existing = Array.isArray(payload.links) ? payload.links[0] : null;
        if (existing?.url) return existing.url;
    }

    const createResponse = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path })
    });
    if (!createResponse.ok) {
        const text = await createResponse.text().catch(() => '');
        throw new Error(text || 'Dropbox shared link creation failed');
    }
    const payload = await createResponse.json().catch(() => ({}));
    return payload?.url || '';
};

export const toDirectDropboxUrl = (url, kind = 'file') => {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (kind === 'image') {
        return raw.replace('?dl=0', '?raw=1');
    }
    return raw.replace('?dl=0', '?dl=1');
};
