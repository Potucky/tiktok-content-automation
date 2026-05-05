# tiktok-token-exchange

Supabase Edge Function that securely exchanges a TikTok OAuth authorization
code for an access token.  The `access_token` and `refresh_token` are **never**
returned to the browser — they must be stored server-side before this function
goes to production.

---

## Required secrets

Set these via the Supabase CLI before deploying:

```bash
supabase secrets set TIKTOK_CLIENT_KEY=<your_client_key>
supabase secrets set TIKTOK_CLIENT_SECRET=<your_client_secret>
supabase secrets set TIKTOK_REDIRECT_URI=<your_redirect_uri>
supabase secrets set ALLOWED_ORIGIN=<your_frontend_origin>
```

| Secret | Description |
|---|---|
| `TIKTOK_CLIENT_KEY` | App client key from TikTok Developer Portal |
| `TIKTOK_CLIENT_SECRET` | App client secret — never logged, never returned to browser |
| `TIKTOK_REDIRECT_URI` | Must exactly match the URI registered in TikTok Developer Portal |
| `ALLOWED_ORIGIN` | Frontend origin for CORS, e.g. `https://yourdomain.com` |

---

## Deploy

```bash
supabase functions deploy tiktok-token-exchange
```

---

## Request

```
POST /functions/v1/tiktok-token-exchange
Content-Type: application/json

{
  "code": "<authorization_code_from_tiktok>",
  "state": "<optional_state_value>"
}
```

---

## Response

**Success:**
```json
{
  "ok": true,
  "tokenReceived": true,
  "openIdReceived": true,
  "scope": "user.info.basic,video.upload",
  "tokenType": "Bearer",
  "expiresIn": 86400
}
```

**TikTok error:**
```json
{
  "ok": false,
  "error": "invalid_grant",
  "error_description": "Authorization code has expired.",
  "log_id": "..."
}
```

**Missing or invalid input:**
```json
{ "ok": false, "error": "Missing required field: code" }
```

**Server configuration error (missing secrets):**
```json
{ "ok": false, "error": "Server configuration error" }
```

---

## Local test (after `supabase start`)

```bash
supabase functions serve tiktok-token-exchange --env-file .env.local

curl -i -X POST http://localhost:54321/functions/v1/tiktok-token-exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"<real_sandbox_code>"}'
```

---

## Security notes

- `TIKTOK_CLIENT_SECRET` is only sent to TikTok's token endpoint — it is never
  logged and never returned to the caller.
- `access_token` and `refresh_token` are intentionally stripped from the response.
- Before going to production, persist tokens in a Supabase table row keyed by
  `open_id` and return only a session reference to the browser.
