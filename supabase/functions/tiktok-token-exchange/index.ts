// tiktok-token-exchange — Supabase Edge Function
//
// Receives a TikTok authorization code from the frontend and exchanges it
// for an access token server-side.  The access_token and refresh_token are
// NEVER forwarded to the browser — they must be stored server-side (e.g. a
// Supabase DB row keyed by open_id) before this function goes to production.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   TIKTOK_CLIENT_KEY      — app client_key from TikTok Developer Portal
//   TIKTOK_CLIENT_SECRET   — app client_secret (never logged, never returned)
//   TIKTOK_REDIRECT_URI    — must match the URI registered in TikTok Developer Portal
//   ALLOWED_ORIGIN         — frontend origin, e.g. https://yourdomain.com

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

// TikTok v2 token endpoint response shape
interface TikTokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  log_id?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Method guard ────────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let code: string | undefined;
  try {
    const body = (await req.json()) as { code?: string; state?: string };
    code = body.code;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!code) {
    return json({ ok: false, error: "Missing required field: code" }, 400);
  }

  // ── Read secrets ────────────────────────────────────────────────────────────
  // SECURITY: values are never logged or returned to the caller.
  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY");
  const clientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET");
  const redirectUri = Deno.env.get("TIKTOK_REDIRECT_URI");

  if (!clientKey || !clientSecret || !redirectUri) {
    // Log which *names* are absent — never log values.
    const missing = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"]
      .filter((k) => !Deno.env.get(k))
      .join(", ");
    console.error(`[tiktok-token-exchange] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  // ── Exchange code → token ───────────────────────────────────────────────────
  // client_secret is sent to TikTok only; it never leaves this function.
  const formBody = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret, // server-side only — never logged, never returned
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  let tikTokData: TikTokTokenResponse;
  try {
    const tikTokRes = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    tikTokData = (await tikTokRes.json()) as TikTokTokenResponse;
  } catch (err) {
    // Safe to log the error message — it contains no secrets.
    console.error(
      "[tiktok-token-exchange] Fetch to TikTok failed:",
      (err as Error).message,
    );
    return json({ ok: false, error: "Failed to reach TikTok token endpoint" }, 502);
  }

  // ── TikTok returned an error ────────────────────────────────────────────────
  if (tikTokData.error) {
    return json(
      {
        ok: false,
        error: tikTokData.error,
        error_description: tikTokData.error_description ?? null,
        log_id: tikTokData.log_id ?? null,
      },
      400,
    );
  }

  // ── Success — return only safe fields ──────────────────────────────────────
  //
  // SECURITY: access_token and refresh_token are intentionally omitted.
  // TODO (before production): persist access_token + refresh_token in a
  //   Supabase table row keyed by open_id, then return only a session
  //   reference (e.g. a short-lived signed JWT or a row ID) to the browser.
  //
  return json({
    ok: true,
    tokenReceived: !!tikTokData.access_token,
    openIdReceived: !!tikTokData.open_id,
    scope: tikTokData.scope ?? null,
    tokenType: tikTokData.token_type ?? null,
    expiresIn: tikTokData.expires_in ?? null,
  });
});
