-- Add public TikTok profile fields to creatorflow_tiktok_connections.
-- These fields are safe to store and return to the frontend.
-- access_token and refresh_token remain in existing columns (server-side only).
ALTER TABLE creatorflow_tiktok_connections
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS username     TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT;
