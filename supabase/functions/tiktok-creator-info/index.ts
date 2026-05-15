// tiktok-creator-info — Supabase Edge Function
//
// Retrieves TikTok creator info for the connected account.
// Calls POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/
// access_token is used server-side only; never logged, never returned to the caller.
//
// Required secrets:
//   SUPABASE_URL              — project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key; server-side only
//   ALLOWED_ORIGIN            — frontend origin for CORS (required — no wildcard fallback)
//   TIKTOK_ENV                — must be exactly "production"

const DB_TABLE = "creatorflow_tiktok_connections";

interface ConnectionRecord {
  open_id?: string;
  access_token?: string;
  scope?: string;
  last_token_exchange_at?: string;
  display_name?: string;
  username?: string;
  [key: string]: unknown;
}

interface TikTokCreatorInfoResponse {
  data?: {
    creator_avatar_url?: string;
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-creator-info] ALLOWED_ORIGIN is not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

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

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const tiktokEnv = Deno.env.get("TIKTOK_ENV");
  if (tiktokEnv !== "production") {
    console.error(
      `[tiktok-creator-info] TIKTOK_ENV="${tiktokEnv ?? "(not set)"}" — must be "production"`,
    );
    return json({ ok: false, error: "Function is restricted to production environment" }, 403);
  }

  // open_id is optional: if provided, look up that exact connection;
  // otherwise fall back to the most recently exchanged connection.
  // (This is a read-only endpoint — fallback is safe here unlike publish.)
  let requestOpenId: string | undefined;
  try {
    const body = (await req.json()) as { open_id?: string };
    requestOpenId = body.open_id ?? undefined;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      .filter((k) => !Deno.env.get(k))
      .join(", ");
    console.error(`[tiktok-creator-info] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  // Load connection — filtered by open_id if provided, else most recent
  let connection: ConnectionRecord | null;
  try {
    const query = requestOpenId
      ? `open_id=eq.${encodeURIComponent(requestOpenId)}&limit=1`
      : `order=last_token_exchange_at.desc&limit=1`;

    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/${DB_TABLE}?${query}`,
      {
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Accept": "application/json",
        },
      },
    );

    if (!dbRes.ok) {
      console.error(`[tiktok-creator-info] DB fetch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to load TikTok connection" }, 500);
    }

    const rows = (await dbRes.json()) as ConnectionRecord[];
    connection = rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error("[tiktok-creator-info] DB fetch threw:", (err as Error).message);
    return json({ ok: false, error: "Failed to load TikTok connection" }, 502);
  }

  if (!connection) {
    return json({
      ok: false,
      creatorInfoAvailable: false,
      error: "Connect TikTok before loading creator info.",
    }, 404);
  }

  if (!connection.access_token) {
    return json({
      ok: false,
      creatorInfoAvailable: false,
      error: "TikTok authorization expired or was revoked. Please reconnect TikTok.",
    }, 401);
  }

  // Call TikTok creator_info/query — access_token used server-side only; never logged, never returned
  try {
    const creatorRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({}),
      },
    );

    const creatorData = (await creatorRes.json()) as TikTokCreatorInfoResponse;

    console.log(
      `[tiktok-creator-info] status=${creatorRes.status} error_code=${creatorData.error?.code ?? "none"}`,
    );

    if (!creatorRes.ok) {
      return json({
        ok: false,
        creatorInfoAvailable: false,
        tikTokErrorCode: creatorData.error?.code,
        tikTokErrorMessage: creatorData.error?.message,
        tikTokLogId: creatorData.error?.log_id ?? null,
        error: "TikTok creator info request failed.",
      }, 502);
    }

    const tikTokOk = !creatorData.error?.code || creatorData.error.code === "ok";
    if (!tikTokOk) {
      return json({
        ok: false,
        creatorInfoAvailable: false,
        tikTokErrorCode: creatorData.error?.code,
        tikTokErrorMessage: creatorData.error?.message,
        tikTokLogId: creatorData.error?.log_id ?? null,
      }, 502);
    }

    const d = creatorData.data;
    return json({
      ok: true,
      creatorInfoAvailable: d != null,
      creator_avatar_url: d?.creator_avatar_url ?? null,
      creator_username: d?.creator_username ?? null,
      creator_nickname: d?.creator_nickname ?? null,
      privacy_level_options: d?.privacy_level_options ?? null,
      comment_disabled: d?.comment_disabled ?? false,
      duet_disabled: d?.duet_disabled ?? false,
      stitch_disabled: d?.stitch_disabled ?? false,
      max_video_post_duration_sec: d?.max_video_post_duration_sec ?? null,
      tikTokLogId: creatorData.error?.log_id ?? null,
    });
  } catch (err) {
    console.error("[tiktok-creator-info] Request threw:", (err as Error).message);
    return json({ ok: false, creatorInfoAvailable: false, error: "Failed to reach TikTok API" }, 502);
  }
});
