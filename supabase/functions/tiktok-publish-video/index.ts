// tiktok-publish-video — Supabase Edge Function
//
// Skeleton: loads the latest TikTok connection record and validates token
// presence before making any outbound call to TikTok.  The actual Content
// Posting API upload is not yet implemented.
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_URL              — project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key; server-side only, never returned
//   ALLOWED_ORIGIN            — frontend origin for CORS (optional, defaults to "*")

const DB_TABLE = "creatorflow_tiktok_connections";

interface ConnectionRecord {
  open_id?: string;
  access_token?: string;
  refresh_token?: string;
  [key: string]: unknown;
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
  let videoUrl: string | undefined;
  let title: string | undefined;
  let privacyLevel: string | undefined;

  try {
    const body = (await req.json()) as {
      video_url?: string;
      title?: string;
      privacy_level?: string;
    };
    videoUrl = body.video_url;
    title = body.title;
    privacyLevel = body.privacy_level;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!videoUrl) {
    return json({ ok: false, error: "Missing required field: video_url" }, 400);
  }
  if (!title) {
    return json({ ok: false, error: "Missing required field: title" }, 400);
  }

  // ── Read secrets ────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      .filter((k) => !Deno.env.get(k))
      .join(", ");
    console.error(`[tiktok-publish-video] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  // ── Load latest TikTok connection from DB ───────────────────────────────────
  // Ordered by last_token_exchange_at descending so the most recently
  // refreshed token is used.  access_token is read server-side only and is
  // never logged or returned to the caller.
  let connection: ConnectionRecord | null = null;
  try {
    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/${DB_TABLE}?order=last_token_exchange_at.desc&limit=1`,
      {
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Accept": "application/json",
        },
      },
    );

    if (!dbRes.ok) {
      console.error(`[tiktok-publish-video] DB fetch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to load TikTok connection" }, 500);
    }

    const rows = (await dbRes.json()) as ConnectionRecord[];
    connection = rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error(
      "[tiktok-publish-video] DB fetch threw:",
      (err as Error).message,
    );
    return json({ ok: false, error: "Failed to load TikTok connection" }, 502);
  }

  // ── Guard: connection must exist and carry a token ─────────────────────────
  const connectionFound = connection !== null;
  const tokenAvailable = connectionFound && !!connection!.access_token;
  const openIdPresent = connectionFound && !!connection!.open_id;

  if (!connectionFound) {
    return json({ ok: false, error: "No TikTok connection found" }, 404);
  }
  if (!tokenAvailable) {
    return json({ ok: false, error: "TikTok access token unavailable" }, 401);
  }

  // ── Skeleton response — upload not yet implemented ─────────────────────────
  // SECURITY: access_token and refresh_token are intentionally absent.
  return json({
    ok: true,
    connectionFound,
    tokenAvailable,
    openIdPresent,
    requestedVideoUrl: videoUrl,
    requestedTitle: title,
    ...(privacyLevel !== undefined && { requestedPrivacyLevel: privacyLevel }),
    nextStep: "TikTok Content Posting API upload call not implemented yet",
  });
});
