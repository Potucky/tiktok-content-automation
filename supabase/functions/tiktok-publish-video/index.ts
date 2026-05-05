// tiktok-publish-video — Supabase Edge Function
//
// Initiates a TikTok Content Posting API inbox upload via PULL_FROM_URL.
// Tokens are NEVER returned to the browser or written to logs.
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

  // ── Call TikTok Content Posting API — inbox upload init ───────────────────
  // PULL_FROM_URL: TikTok fetches the video from videoUrl server-to-server.
  // access_token is used here server-side only; never logged, never returned.
  interface TikTokInitResponse {
    data?: {
      publish_id?: string;
      upload_url?: string;
    };
    error?: {
      code?: string;
      message?: string;
      log_id?: string;
    };
  }

  let tikTokData: TikTokInitResponse;
  try {
    const tikTokRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection!.access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          source_info: {
            source: "PULL_FROM_URL",
            video_url: videoUrl,
          },
        }),
      },
    );

    tikTokData = (await tikTokRes.json()) as TikTokInitResponse;

    if (!tikTokRes.ok) {
      console.error(
        `[tiktok-publish-video] TikTok init failed: HTTP ${tikTokRes.status}`,
      );
      return json(
        {
          ok: false,
          connectionFound,
          tokenAvailable,
          openIdPresent,
          requestedVideoUrl: videoUrl,
          requestedTitle: title,
          ...(privacyLevel !== undefined && { requestedPrivacyLevel: privacyLevel }),
          tikTokStatus: tikTokRes.status,
          ...(tikTokData.error?.code !== undefined && { tikTokErrorCode: tikTokData.error.code }),
          ...(tikTokData.error?.message !== undefined && { tikTokErrorMessage: tikTokData.error.message }),
          ...(tikTokData.error?.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
        },
        502,
      );
    }
  } catch (err) {
    console.error(
      "[tiktok-publish-video] TikTok init threw:",
      (err as Error).message,
    );
    return json({ ok: false, error: "Failed to reach TikTok API" }, 502);
  }

  // ── Guard: TikTok application-level error ─────────────────────────────────
  if (tikTokData.error?.code && tikTokData.error.code !== "ok") {
    return json(
      {
        ok: false,
        connectionFound,
        tokenAvailable,
        openIdPresent,
        requestedVideoUrl: videoUrl,
        requestedTitle: title,
        ...(privacyLevel !== undefined && { requestedPrivacyLevel: privacyLevel }),
        tikTokErrorCode: tikTokData.error.code,
        ...(tikTokData.error.message !== undefined && { tikTokErrorMessage: tikTokData.error.message }),
        ...(tikTokData.error.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
      },
      502,
    );
  }

  // ── Return safe fields only ────────────────────────────────────────────────
  // SECURITY: access_token and refresh_token are intentionally absent.
  return json({
    ok: true,
    connectionFound,
    tokenAvailable,
    openIdPresent,
    requestedVideoUrl: videoUrl,
    requestedTitle: title,
    ...(privacyLevel !== undefined && { requestedPrivacyLevel: privacyLevel }),
    tikTokStatus: 200,
    ...(tikTokData.data?.publish_id !== undefined && { publishId: tikTokData.data.publish_id }),
    uploadUrlReceived: !!tikTokData.data?.upload_url,
    ...(tikTokData.error?.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
  });
});
