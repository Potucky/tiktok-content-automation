# Content Posting API Compliance Notes

CreatorFlow Studio must not behave like a hidden auto-posting bot.

## Required user control

The posting flow should show:

1. Connected creator account / nickname.
2. Video preview.
3. Editable title.
4. Privacy status selector.
5. Comment / Duet / Stitch options where supported.
6. Commercial content disclosure.
7. Required consent before upload/publish.
8. Post status after submission.

## Important behavior

The app must not:

- scrape content
- automate engagement
- add promotional watermarks
- post without user consent
- hide which account is being used
- use client_secret in frontend/mobile code

## Safer architecture

Allowed production-style workflow:

GitHub Actions / Supabase prepares content drafts.
CreatorFlow Studio displays a queue of prepared drafts.
User opens a draft.
User previews the video.
User chooses title, privacy, interactions, disclosure.
User confirms consent.
Only then the app uploads/publishes through TikTok API.

Risky workflow:

GitHub Actions silently posts videos without user confirmation.
This may fail review because TikTok expects user awareness and control.
