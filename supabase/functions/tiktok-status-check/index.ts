// tiktok-status-check — Supabase Edge Function
//
// Fetches TikTok publish status for a given publishId using the stored access token.
// access_token is used server-side only; never logged, never returned to the caller.
//
// SECURITY: caller must supply open_id in the request body. The DB lookup is
// filtered to that specific connection. Falling back to the latest connection
// is intentionally not supported — a missing open_id returns HTTP 400.
// Follow-up required: tiktok-token-exchange must return open_id in its
// response so the frontend can supply it here.
//
// Required secrets (shared with tiktok-publish-video):
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
  [key: string]: unknown;
}

function maskOpenId(openId?: string): string | null {
  if (!openId) return null;
  if (openId.length <= 10) return openId.slice(0, 3) + "...";
  return openId.slice(0, 6) + "..." + openId.slice(-4);
}

interface TikTokStatusResponse {
  data?: {
    status?: string;
    fail_reason?: string;
    uploaded_bytes?: number;
    publish_id?: string;
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
    console.error("[tiktok-status-check] ALLOWED_ORIGIN is not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
      `[tiktok-status-check] TIKTOK_ENV="${tiktokEnv ?? "(not set)"}" — must be "production"`,
    );
    return json({ ok: false, error: "Function is restricted to production environment" }, 403);
  }

  let publishId: string;
  let requestOpenId: string | undefined;
  try {
    const body = (await req.json()) as { open_id?: string; publish_id?: string };
    if (!body.open_id) {
      return json(
        {
          ok: false,
          error: "Missing required field: open_id. Caller must supply the open_id from the token exchange response.",
        },
        400,
      );
    }
    if (!body.publish_id) {
      return json({ ok: false, error: "Missing required field: publish_id" }, 400);
    }
    requestOpenId = body.open_id;
    publishId = body.publish_id;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      .filter((k) => !Deno.env.get(k))
      .join(", ");
    console.error(`[tiktok-status-check] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  let connection: ConnectionRecord | null;
  try {
    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/${DB_TABLE}?open_id=eq.${encodeURIComponent(requestOpenId!)}&limit=1`,
      {
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Accept": "application/json",
        },
      },
    );
    if (!dbRes.ok) {
      console.error(`[tiktok-status-check] DB fetch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to load TikTok connection" }, 500);
    }
    const rows = (await dbRes.json()) as ConnectionRecord[];
    connection = rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error("[tiktok-status-check] DB fetch threw:", (err as Error).message);
    return json({ ok: false, error: "Failed to load TikTok connection" }, 502);
  }

  if (!connection) {
    return json({ ok: false, error: "No TikTok connection found" }, 404);
  }
  if (!connection.access_token) {
    return json({ ok: false, error: "TikTok access token unavailable" }, 401);
  }

  // access_token used server-side only; never logged, never returned
  try {
    const statusRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );

    const statusData = (await statusRes.json()) as TikTokStatusResponse;

    if (!statusRes.ok) {
      console.error(`[tiktok-status-check] TikTok status fetch failed: HTTP ${statusRes.status}`);
    }

    const tikTokOk = !statusData.error?.code || statusData.error.code === "ok";
    return json({
      ok: statusRes.ok && tikTokOk,
      statusCheckOk: statusRes.ok,
      publishId,
      publishStatus: statusData.data?.status ?? null,
      failReason: statusData.data?.fail_reason ?? null,
      uploadedBytes: statusData.data?.uploaded_bytes ?? null,
      connectionOpenIdMasked: maskOpenId(connection.open_id),
      ...(connection.scope != null && { connectionScope: connection.scope }),
      ...(connection.last_token_exchange_at != null && { connectionLastTokenExchangeAt: connection.last_token_exchange_at }),
      ...(!tikTokOk && {
        tikTokErrorCode: statusData.error?.code,
        tikTokErrorMessage: statusData.error?.message,
        tikTokLogId: statusData.error?.log_id,
      }),
    });
  } catch (err) {
    console.error("[tiktok-status-check] Status fetch threw:", (err as Error).message);
    return json({ ok: false, error: "Failed to reach TikTok API" }, 502);
  }
});
