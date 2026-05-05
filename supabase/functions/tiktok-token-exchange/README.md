# tiktok-token-exchange

Supabase Edge Function that securely exchanges a TikTok OAuth authorization
code for tokens server-side, then persists them to
`public.creatorflow_tiktok_connections` via the Supabase REST API (service
role).  `access_token` and `refresh_token` are **never** returned to the browser.

---

## Required secrets

Set all of these via the Supabase CLI before deploying:

```bash
supabase secrets set TIKTOK_CLIENT_KEY=<your_client_key>
supabase secrets set TIKTOK_CLIENT_SECRET=<your_client_secret>
supabase secrets set TIKTOK_REDIRECT_URI=<your_redirect_uri>
supabase secrets set ALLOWED_ORIGIN=<your_frontend_origin>
supabase secrets set SUPABASE_URL=https://<ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
```

| Secret | Description |
| --- | --- |
| `TIKTOK_CLIENT_KEY` | App client key from TikTok Developer Portal |
| `TIKTOK_CLIENT_SECRET` | App client secret — never logged, never returned to browser |
| `TIKTOK_REDIRECT_URI` | Must exactly match the URI registered in TikTok Developer Portal |
| `ALLOWED_ORIGIN` | Frontend origin for CORS, e.g. `https://yourdomain.com` |
| `SUPABASE_URL` | Project REST base URL, e.g. `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — used only inside this function, never returned |

---

## Deploy

The function is called without a Supabase JWT from the frontend, so deploy
with `--no-verify-jwt` to allow unauthenticated access:

```bash
supabase functions deploy tiktok-token-exchange --no-verify-jwt
```

> **Note:** Add your own request-level auth (e.g. a shared secret header or
> Supabase Auth JWT) before exposing this to production traffic.

---

## Storage behavior

After a successful token exchange the function upserts one row into
`public.creatorflow_tiktok_connections` using `open_id` as the conflict key
(`Prefer: resolution=merge-duplicates`).

Columns written:

| Column | Value |
| --- | --- |
| `open_id` | TikTok user identifier |
| `scope` | Granted scopes |
| `token_type` | e.g. `Bearer` |
| `access_token` | Stored server-side only — never returned to browser |
| `refresh_token` | Stored server-side only — never returned to browser |
| `expires_in` | Seconds until access token expires |
| `access_token_expires_at` | `now + expires_in` as ISO timestamp |
| `refresh_expires_in` | If returned by TikTok |
| `refresh_token_expires_at` | `now + refresh_expires_in` as ISO timestamp (if available) |
| `last_token_exchange_at` | Timestamp of this exchange |

---

## Request

```http
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
  "stored": true,
  "scope": "user.info.basic,video.upload",
  "tokenType": "Bearer",
  "expiresIn": 86400
}
```

**DB storage failed:**

```json
{ "ok": false, "error": "token_storage_failed" }
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
supabase functions serve tiktok-token-exchange --no-verify-jwt --env-file .env.local
```

```bash
curl -i -X POST http://localhost:54321/functions/v1/tiktok-token-exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"<real_sandbox_code>"}'
```

---

## Security notes

- `TIKTOK_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are used only inside
  this function — they are never logged and never included in any response.
- `access_token` and `refresh_token` are written to the database but stripped
  from every response.
- Only the HTTP status code is logged on DB failure — no token values.
