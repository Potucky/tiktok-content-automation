// tiktok-publish-video — Supabase Edge Function
//
// Initiates a TikTok Direct Post (video.publish scope).
// Supports PULL_FROM_URL (default) and FILE_UPLOAD modes.
// FILE_UPLOAD supports optional server-side binary upload (upload_binary: true).
// Tokens and upload_url are NEVER returned to the browser or written to logs.
//
// SECURITY: caller must supply open_id in the request body. The DB lookup is
// filtered to that specific connection. Falling back to the latest connection
// is intentionally not supported — a missing open_id returns HTTP 400.
// Follow-up required: tiktok-token-exchange must return open_id in its
// response so the frontend can supply it here.
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_URL              — project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key; server-side only, never returned
//   ALLOWED_ORIGIN            — frontend origin for CORS (required — no wildcard fallback)
//   TIKTOK_ENV                — must be exactly "production"; function refuses otherwise

const DB_TABLE = "creatorflow_tiktok_connections";

type UploadMode = "PULL_FROM_URL" | "FILE_UPLOAD";

interface ConnectionRecord {
  open_id?: string;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  last_token_exchange_at?: string;
  [key: string]: unknown;
}

function maskOpenId(openId?: string): string | null {
  if (!openId) return null;
  if (openId.length <= 10) return openId.slice(0, 3) + "...";
  return openId.slice(0, 6) + "..." + openId.slice(-4);
}

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
  // ── ALLOWED_ORIGIN is required — no wildcard fallback ──────────────────────
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-publish-video] ALLOWED_ORIGIN is not configured");
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

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Method guard ────────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // ── Production guard — function must not run outside production environment ──
  const tiktokEnv = Deno.env.get("TIKTOK_ENV");
  if (tiktokEnv !== "production") {
    console.error(
      `[tiktok-publish-video] TIKTOK_ENV="${tiktokEnv ?? "(not set)"}" — must be "production"`,
    );
    return json({ ok: false, error: "Function is restricted to production environment" }, 403);
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let uploadMode: UploadMode;
  let uploadBinary: boolean;
  let checkStatus: boolean;
  let videoUrl: string | undefined;
  let title: string | undefined;
  let privacyLevel: string | undefined;
  let videoSize: number | undefined;
  let chunkSize: number | undefined;
  let totalChunkCount: number | undefined;
  let requestOpenId: string | undefined;

  try {
    const body = (await req.json()) as {
      open_id?: string;
      upload_mode?: string;
      upload_binary?: boolean;
      check_status?: boolean;
      video_url?: string;
      title?: string;
      privacy_level?: string;
      video_size?: number;
      chunk_size?: number;
      total_chunk_count?: number;
    };
    requestOpenId = body.open_id;

    const rawMode = body.upload_mode ?? "PULL_FROM_URL";
    if (rawMode !== "PULL_FROM_URL" && rawMode !== "FILE_UPLOAD") {
      return json(
        { ok: false, error: "upload_mode must be PULL_FROM_URL or FILE_UPLOAD" },
        400,
      );
    }
    uploadMode = rawMode;
    uploadBinary = body.upload_binary === true;
    checkStatus = body.check_status === true;
    videoUrl = body.video_url;
    title = body.title;
    privacyLevel = body.privacy_level;
    videoSize = body.video_size;
    chunkSize = body.chunk_size;
    totalChunkCount = body.total_chunk_count;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  // ── Require caller-supplied open_id — no fallback to latest connection ──────
  if (!requestOpenId) {
    return json(
      {
        ok: false,
        error: "Missing required field: open_id. Caller must supply the open_id from the token exchange response.",
      },
      400,
    );
  }

  // ── Field validation per mode ───────────────────────────────────────────────
  if (!title) {
    return json({ ok: false, error: "Missing required field: title" }, 400);
  }

  if (uploadMode === "PULL_FROM_URL") {
    if (!videoUrl) {
      return json(
        { ok: false, error: "Missing required field: video_url for PULL_FROM_URL mode" },
        400,
      );
    }
  } else {
    // FILE_UPLOAD
    if (uploadBinary) {
      // video_url required for server-side download; video_size derived from bytes if absent
      if (!videoUrl) {
        return json(
          { ok: false, error: "Missing required field: video_url for FILE_UPLOAD with upload_binary" },
          400,
        );
      }
    } else {
      // init-only: video_size must be known up front
      if (videoSize === undefined) {
        return json(
          { ok: false, error: "Missing required field: video_size for FILE_UPLOAD mode" },
          400,
        );
      }
      chunkSize = chunkSize ?? videoSize;
      totalChunkCount = totalChunkCount ?? 1;
    }
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

  // ── Load TikTok connection for the supplied open_id ─────────────────────────
  // Filtered by the caller-provided open_id — no fallback to latest row.
  // access_token is read server-side only and is never logged or returned.
  let connection: ConnectionRecord | null;
  try {
    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/${DB_TABLE}?open_id=eq.${encodeURIComponent(requestOpenId)}&limit=1`,
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
    console.error("[tiktok-publish-video] DB fetch threw:", (err as Error).message);
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

  // ── Download video bytes (FILE_UPLOAD + upload_binary only) ────────────────
  // videoSize may be derived here if the caller did not supply it.
  let videoBytes: ArrayBuffer | null = null;
  if (uploadMode === "FILE_UPLOAD" && uploadBinary) {
    try {
      const dlRes = await fetch(videoUrl!);
      if (!dlRes.ok) {
        console.error(`[tiktok-publish-video] Video download failed: HTTP ${dlRes.status}`);
        return json(
          { ok: false, error: "Failed to download video from video_url", downloadStatus: dlRes.status },
          502,
        );
      }
      videoBytes = await dlRes.arrayBuffer();
      if (videoSize === undefined) {
        videoSize = videoBytes.byteLength;
      }
    } catch (err) {
      console.error("[tiktok-publish-video] Video download threw:", (err as Error).message);
      return json({ ok: false, error: "Failed to download video from video_url" }, 502);
    }
    // Apply defaults now that videoSize is known
    chunkSize = chunkSize ?? videoSize;
    totalChunkCount = totalChunkCount ?? 1;
  }

  // ── Build source_info per mode ─────────────────────────────────────────────
  const sourceInfo =
    uploadMode === "PULL_FROM_URL"
      ? { source: "PULL_FROM_URL", video_url: videoUrl }
      : {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        };

  // ── Shared safe diagnostic fields (tokens and upload_url intentionally absent)
  const diagnostics = {
    uploadMode,
    uploadBinary,
    connectionFound,
    tokenAvailable,
    openIdPresent,
    connectionOpenIdMasked: maskOpenId(connection!.open_id),
    ...(connection!.scope != null && { connectionScope: connection!.scope }),
    ...(connection!.last_token_exchange_at != null && { connectionLastTokenExchangeAt: connection!.last_token_exchange_at }),
    ...(videoUrl !== undefined && { requestedVideoUrl: videoUrl }),
    requestedTitle: title,
    ...(privacyLevel !== undefined && { requestedPrivacyLevel: privacyLevel }),
    ...(videoSize !== undefined && { videoSize }),
    ...(chunkSize !== undefined && { chunkSize }),
    ...(totalChunkCount !== undefined && { totalChunkCount }),
  };

  // ── Call TikTok Direct Post API — production publish init ─────────────────
  // access_token is used here server-side only; never logged, never returned.
  // post_info is required by the direct post endpoint (video.publish scope).
  const postInfo = {
    title: title!,
    privacy_level: privacyLevel ?? "SELF_ONLY",
  };

  console.log("[tiktok-publish-video] endpoint=direct_post privacy_level=" + postInfo.privacy_level);

  let tikTokData: TikTokInitResponse;
  try {
    const tikTokRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection!.access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ post_info: postInfo, source_info: sourceInfo }),
      },
    );

    tikTokData = (await tikTokRes.json()) as TikTokInitResponse;

    console.log(
      `[tiktok-publish-video] init status=${tikTokRes.status} publish_id_present=${!!tikTokData.data?.publish_id} upload_url_present=${!!tikTokData.data?.upload_url}`,
    );

    if (!tikTokRes.ok) {
      console.error(
        `[tiktok-publish-video] TikTok init failed: HTTP ${tikTokRes.status}`,
      );
      return json(
        {
          ok: false,
          ...diagnostics,
          tikTokStatus: tikTokRes.status,
          ...(tikTokData.error?.code !== undefined && { tikTokErrorCode: tikTokData.error.code }),
          ...(tikTokData.error?.message !== undefined && { tikTokErrorMessage: tikTokData.error.message }),
          ...(tikTokData.error?.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
        },
        502,
      );
    }
  } catch (err) {
    console.error("[tiktok-publish-video] TikTok init threw:", (err as Error).message);
    return json({ ok: false, error: "Failed to reach TikTok API" }, 502);
  }

  // ── Guard: TikTok application-level error ─────────────────────────────────
  if (tikTokData.error?.code && tikTokData.error.code !== "ok") {
    return json(
      {
        ok: false,
        ...diagnostics,
        tikTokErrorCode: tikTokData.error.code,
        ...(tikTokData.error.message !== undefined && { tikTokErrorMessage: tikTokData.error.message }),
        ...(tikTokData.error.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
      },
      502,
    );
  }

  const uploadUrlReceived = !!tikTokData.data?.upload_url;

  // ── Binary PUT to TikTok upload_url (FILE_UPLOAD + upload_binary only) ─────
  // upload_url is consumed server-side only; never logged, never returned.
  let binaryUploadAttempted = false;
  let binaryUploadStatus: number | undefined;
  let binaryUploadOk: boolean | undefined;

  if (uploadMode === "FILE_UPLOAD" && uploadBinary && videoBytes !== null) {
    const uploadUrl = tikTokData.data?.upload_url;
    if (!uploadUrl) {
      return json(
        {
          ok: false,
          ...diagnostics,
          tikTokStatus: 200,
          uploadUrlReceived,
          binaryUploadAttempted: false,
          error: "TikTok did not return upload_url",
        },
        502,
      );
    }

    binaryUploadAttempted = true;
    try {
      const putHeaders: Record<string, string> = {
        "Content-Type": "video/mp4",
      };
      if (videoSize !== undefined) {
        putHeaders["Content-Length"] = String(videoSize);
        putHeaders["Content-Range"] = `bytes 0-${videoSize - 1}/${videoSize}`;
      }

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body: videoBytes,
      });

      binaryUploadStatus = putRes.status;
      binaryUploadOk = putRes.ok;

      if (!putRes.ok) {
        console.error(`[tiktok-publish-video] Binary PUT failed: HTTP ${putRes.status}`);
      }
    } catch (err) {
      console.error("[tiktok-publish-video] Binary PUT threw:", (err as Error).message);
      binaryUploadOk = false;
    }
  }

  const publishId = tikTokData.data?.publish_id;
  const uploadOk = binaryUploadAttempted ? binaryUploadOk === true : true;

  // ── Optional: check TikTok publish status ──────────────────────────────────
  // Runs after init/upload if check_status is true and a publish_id is present.
  // A status check failure does not override the upload ok result.
  // access_token is used server-side only; never logged, never returned.
  let statusCheckAttempted = false;
  let statusCheckOk: boolean | undefined;
  let statusCheckHttpStatus: number | undefined;
  let publishStatus: string | undefined;
  let failReason: string | undefined;
  let uploadedBytes: number | undefined;
  let statusTikTokErrorCode: string | undefined;
  let statusTikTokErrorMessage: string | undefined;
  let statusTikTokLogId: string | undefined;

  if (checkStatus && publishId) {
    statusCheckAttempted = true;
    try {
      const statusRes = await fetch(
        "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${connection!.access_token}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ publish_id: publishId }),
        },
      );

      statusCheckHttpStatus = statusRes.status;
      statusCheckOk = statusRes.ok;

      const statusData = (await statusRes.json()) as TikTokStatusResponse;

      if (statusData.data?.status !== undefined) publishStatus = statusData.data.status;
      if (statusData.data?.fail_reason !== undefined) failReason = statusData.data.fail_reason;
      if (statusData.data?.uploaded_bytes !== undefined) uploadedBytes = statusData.data.uploaded_bytes;
      if (statusData.error?.code !== undefined) statusTikTokErrorCode = statusData.error.code;
      if (statusData.error?.message !== undefined) statusTikTokErrorMessage = statusData.error.message;
      if (statusData.error?.log_id !== undefined) statusTikTokLogId = statusData.error.log_id;

      if (!statusRes.ok) {
        console.error(`[tiktok-publish-video] Status check failed: HTTP ${statusRes.status}`);
      }
    } catch (err) {
      console.error("[tiktok-publish-video] Status check threw:", (err as Error).message);
      statusCheckOk = false;
    }
  }

  // ── Return safe fields only ────────────────────────────────────────────────
  // upload_url, access_token, and refresh_token are intentionally absent.
  return json({
    ok: uploadOk,
    ...diagnostics,
    tikTokStatus: 200,
    ...(publishId !== undefined && { publishId }),
    uploadUrlReceived,
    binaryUploadAttempted,
    ...(binaryUploadAttempted && { binaryUploadStatus }),
    ...(binaryUploadAttempted && { binaryUploadOk }),
    ...(tikTokData.error?.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
    statusCheckAttempted,
    ...(statusCheckAttempted && { statusCheckOk }),
    ...(statusCheckAttempted && { statusCheckHttpStatus }),
    ...(publishStatus !== undefined && { publishStatus }),
    ...(failReason !== undefined && { failReason }),
    ...(uploadedBytes !== undefined && { uploadedBytes }),
    ...(statusTikTokErrorCode !== undefined && { statusTikTokErrorCode }),
    ...(statusTikTokErrorMessage !== undefined && { statusTikTokErrorMessage }),
    ...(statusTikTokLogId !== undefined && { statusTikTokLogId }),
  });
});
