# CreatorFlow Studio

A creator tool for managing short-form video publishing workflows through TikTok's official Content Posting API.

## What it does

CreatorFlow Studio lets the authorized account owner connect their own TikTok account and send creator-owned short-form videos to TikTok for review and publishing through TikTok's official Content Posting API.

The app does **not** perform scraping, follower automation, mass liking, mass commenting, artificial engagement, or unauthorized posting.

## Official URLs

| Page | URL |
| --- | --- |
| Public site | <https://potucky.github.io/creatorflow-studio/> |
| Terms of Service | <https://potucky.github.io/creatorflow-studio/terms/> |
| Privacy Policy | <https://potucky.github.io/creatorflow-studio/privacy/> |
| Redirect URI | <https://potucky.github.io/creatorflow-studio/> |

## TikTok integration

- **API**: TikTok Content Posting API (inbox upload)
- **OAuth scopes**: `user.info.basic`, `video.upload`
- **Direct Post**: disabled — videos are sent to the creator's TikTok inbox for review, not auto-published
- **Tokens**: stored server-side in Supabase only; never returned to the browser

## Sandbox status

Current blocker: `FILE_UPLOAD` mode returns HTTP 201 and a `publish_id`, but publish status remains `PROCESSING_UPLOAD`. Under investigation.

## Production review

The TikTok app is currently submitted for production review. Do not recall the review or change production app settings, scopes, URLs, or products while the review is pending.

## Stack

- React + TypeScript + Vite (frontend, GitHub Pages)
- Supabase Edge Functions (token exchange, publish, status check)
- TikTok Content Posting API v2

## Environment variables

Create a `.env.local` file in the project root (never commit real values):

```env
VITE_TIKTOK_CLIENT_KEY=your_client_key_here
VITE_TIKTOK_REDIRECT_URI=https://potucky.github.io/creatorflow-studio/
```

Supabase Edge Function secrets are set via `supabase secrets set` — see [SANDBOX_CHECKLIST.md](SANDBOX_CHECKLIST.md) for the full list.

## Security

- `client_secret` is server-side only; never in frontend code or logs
- `access_token` and `refresh_token` are stored in Supabase and never returned to the browser
- `SUPABASE_SERVICE_ROLE_KEY` is server-side only
- No real secrets in `.env.example` or any committed file
