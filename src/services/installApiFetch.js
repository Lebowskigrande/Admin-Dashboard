import { API_BASE, API_URL } from './apiConfig';

const FETCH_SHIM_FLAG = '__dashboardApiFetchShimInstalled';

const getRequestUrl = (input) => {
    if (input instanceof Request) return input.url;
    return String(input || '');
};

const isApiRequest = (input) => {
    const url = getRequestUrl(input);
    if (!url) return false;
    if (url.startsWith('/api')) return true;
    if (url.startsWith(API_URL)) return true;
    if (url.startsWith(API_BASE)) return true;
    if (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/api`)) {
        return true;
    }
    return false;
};

export const installApiFetchShim = () => {
    if (typeof globalThis.fetch !== 'function') return;
    if (globalThis[FETCH_SHIM_FLAG]) return;

    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init = {}) => {
        if (!isApiRequest(input)) {
            return nativeFetch(input, init);
        }

        return nativeFetch(input, {
            ...init,
            credentials: init.credentials ?? 'include'
        });
    };

    globalThis[FETCH_SHIM_FLAG] = true;
};
