# CreatorFlow Studio Sandbox Checklist

## Current status

- Production TikTok app is in review.
- Do not recall Production review.
- Do not change Production app settings.
- Do not change Production scopes, URLs, products, or review explanation.
- Continue work only in Sandbox and local project.

## Public site checks

- Homepage opens:
  https://potucky.github.io/tiktok-content-automation/

- Terms page opens:
  https://potucky.github.io/tiktok-content-automation/terms/

- Privacy page opens:
  https://potucky.github.io/tiktok-content-automation/privacy/

- Homepage legal buttons point to the correct GitHub Pages project path.
- No legal link points to https://potucky.github.io/terms or https://potucky.github.io/privacy.

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
