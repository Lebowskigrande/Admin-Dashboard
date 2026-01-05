-- Add table for storing Google OAuth tokens
CREATE TABLE IF NOT EXISTS google_tokens (
    id INTEGER PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER
);
