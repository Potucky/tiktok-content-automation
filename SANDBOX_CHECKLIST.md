# CreatorFlow Studio Sandbox Checklist

## Required Edge Function env variables

Set all of these via `supabase secrets set <KEY>=<value>` before deploying or testing functions.

### tiktok-token-exchange

| Variable | Required | Notes |
| --- | --- | --- |
| `TIKTOK_CLIENT_KEY` | yes | App client_key from TikTok Developer Portal |
| `TIKTOK_CLIENT_SECRET` | yes | Never logged, never returned to caller |
| `TIKTOK_REDIRECT_URI` | yes | Must exactly match TikTok Developer Portal |
| `ALLOWED_ORIGIN` | yes | Frontend origin, e.g. `https://potucky.github.io` — no wildcard fallback |
| `SUPABASE_URL` | yes | Project REST base URL, e.g. `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side only, never returned |

### tiktok-publish-video

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project REST base URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side only, never returned |
| `ALLOWED_ORIGIN` | yes | Frontend origin — no wildcard fallback |
| `TIKTOK_ENV` | yes | Must be exactly `sandbox` — function refuses all requests otherwise |

## Current status

- Production TikTok app is in review.
- Do not recall Production review.
- Do not change Production app settings.
- Do not change Production scopes, URLs, products, or review explanation.
- Continue work only in Sandbox and local project.

## Public site checks

- Homepage opens:
  <https://potucky.github.io/tiktok-content-automation/>

- Terms page opens:
  <https://potucky.github.io/tiktok-content-automation/terms/>

- Privacy page opens:
  <https://potucky.github.io/tiktok-content-automation/privacy/>

- Homepage legal buttons point to the correct GitHub Pages project path.
- No legal link points to <https://potucky.github.io/terms> or <https://potucky.github.io/privacy>.

## Sandbox OAuth checks

- Connect TikTok Sandbox button is visible.
- Redirect URI is correct.
- OAuth redirect returns to the site.
- Authorization code is received.
- Code exchange works through Supabase Edge Function.
- Token is stored in Supabase.
- UI does not expose access token.
- UI does not expose refresh token.
- UI does not expose client secret.
- UI does not expose service role key.

## Sandbox upload checks

- Test video upload starts from the frontend.
- Supabase Edge Function handles upload.
- Binary upload returns HTTP 201.
- Upload status check works.
- Publish result shows PROCESSING_UPLOAD or another valid TikTok status.
- UI does not expose upload_url.

## Direct Post readiness

- Add connected account info block.
- Add selected video block.
- Add caption input.
- Add privacy settings selector.
- Add explicit user consent checkbox.
- Prepare future backend video.publish flow.
- Keep Sandbox and Production behavior clearly separated.

## Next after approval

- Re-authorize TikTok account with Production scopes.
- Test production token exchange.
- Test production upload flow.
- Test Direct Post only after approval.
