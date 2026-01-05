const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

export const API_BASE = trimTrailingSlash(
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
);

export const API_URL = `${API_BASE}/api`;
