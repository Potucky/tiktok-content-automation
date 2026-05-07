# CreatorFlow Studio / TikTok Content Automation — Project Progress Log

This document tracks important project work, completed milestones, deployment notes, and next steps.

---

## 2026-05-07 — TikTok Sandbox Upload Flow Prepared and Verified

### Summary

We prepared, hardened, deployed, and verified the TikTok Sandbox Inbox Upload flow for CreatorFlow Studio / TikTok Content Automation.

The Production Video Publish API review remains untouched. All work was focused on safe Sandbox testing and preparation.

### Completed Work

- Confirmed GitHub Pages frontend is deployed and working.
- Confirmed TikTok OAuth authorization works from the public demo site.
- Confirmed Supabase Edge Functions are deployed and ACTIVE:
  - `tiktok-token-exchange`
  - `tiktok-publish-video`
- Confirmed Supabase secrets are configured:
  - `ALLOWED_ORIGIN`
  - `TIKTOK_ENV=sandbox`
  - `TIKTOK_CLIENT_KEY`
  - `TIKTOK_CLIENT_SECRET`
  - `TIKTOK_REDIRECT_URI`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`
- Confirmed database table exists:
  - `public.creatorflow_tiktok_connections`
- Confirmed `open_id` is the primary key for TikTok connection storage.
- Confirmed TikTok token storage works.
- Confirmed Sandbox Inbox Upload test works through the public UI.

### Sandbox Upload Test Result

The controlled Sandbox Inbox Upload test returned:

- `ok = true`
- `binaryUploadOk = true`
- `binaryUploadStatus = 201`
- `statusCheckOk = true`
- `publishStatus = PROCESSING_UPLOAD`
- TikTok returned a valid `publishId`
- No sensitive values were exposed in the UI:
  - no `access_token`
  - no `refresh_token`
  - no `upload_url`
  - no `client_secret`
  - no `service_role_key`

### Security / Safety Hardening

Added or verified Sandbox safety guards:

- Removed unsafe `ALLOWED_ORIGIN="*"` fallback.
- Both Edge Functions now require `ALLOWED_ORIGIN`.
- Missing `ALLOWED_ORIGIN` returns a clear server configuration error.
- `tiktok-publish-video` refuses to run unless `TIKTOK_ENV` is exactly `sandbox`.
- UI wording was clarified from generic publish language to Inbox Upload language.
- TikTok API endpoints and upload logic were not changed.
- Supabase schema was not changed.
- Production review settings were not touched.

### Validation

Completed successfully:

- `npm run lint`
- `npm run build`
- `npm run deploy`
- Supabase function deploy:
  - `tiktok-token-exchange`
  - `tiktok-publish-video`
- Git push to `main`

### Latest Important Git Commits

- `2360aa1 Harden TikTok sandbox upload flow`
- `ce26bf6 Add Sandbox checklist`
- `9815625 Fix legal links and light review theme`
- `6708d2b Add TikTok demo publish flow UI`
- `3fbd057 Point TikTok OAuth frontend to new Supabase project`

### Current Status

Sandbox flow is ready and verified.

Production Video Publish review is still pending and should not be disturbed.

### Next Steps

1. Wait for TikTok Production Video Publish API review result.
2. Keep Sandbox and Production behavior clearly separated.
3. After approval, re-authorize the TikTok account with Production scopes.
4. Test production token exchange carefully.
5. Test production upload flow only after approval.
6. Prepare Direct Post flow separately from Inbox Upload flow.
7. Continue updating this document after every meaningful project milestone.

