// tiktok-publish-video — Supabase Edge Function
//
// Initiates a TikTok Content Posting API inbox upload.
// Supports PULL_FROM_URL (default) and FILE_UPLOAD modes.
// FILE_UPLOAD supports optional server-side binary upload (upload_binary: true).
// Tokens and upload_url are NEVER returned to the browser or written to logs.
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_URL              — project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key; server-side only, never returned
//   ALLOWED_ORIGIN            — frontend origin for CORS (optional, defaults to "*")

const DB_TABLE = "creatorflow_tiktok_connections";

type UploadMode = "PULL_FROM_URL" | "FILE_UPLOAD";

interface ConnectionRecord {
  open_id?: string;
  access_token?: string;
  refresh_token?: string;
  [key: string]: unknown;
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
  let uploadMode: UploadMode;
  let uploadBinary: boolean;
  let videoUrl: string | undefined;
  let title: string | undefined;
  let privacyLevel: string | undefined;
  let videoSize: number | undefined;
  let chunkSize: number | undefined;
  let totalChunkCount: number | undefined;

  try {
    const body = (await req.json()) as {
      upload_mode?: string;
      upload_binary?: boolean;
      video_url?: string;
      title?: string;
      privacy_level?: string;
      video_size?: number;
      chunk_size?: number;
      total_chunk_count?: number;
    };

    const rawMode = body.upload_mode ?? "PULL_FROM_URL";
    if (rawMode !== "PULL_FROM_URL" && rawMode !== "FILE_UPLOAD") {
      return json(
        { ok: false, error: "upload_mode must be PULL_FROM_URL or FILE_UPLOAD" },
        400,
      );
    }
    uploadMode = rawMode;
    uploadBinary = body.upload_binary === true;
    videoUrl = body.video_url;
    title = body.title;
    privacyLevel = body.privacy_level;
    videoSize = body.video_size;
    chunkSize = body.chunk_size;
    totalChunkCount = body.total_chunk_count;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
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
    ...(videoUrl !== undefined && { requestedVideoUrl: videoUrl }),
    requestedTitle: title,
    ...(privacyLevel !== undefined && { requestedPrivacyLevel: privacyLevel }),
    ...(videoSize !== undefined && { videoSize }),
    ...(chunkSize !== undefined && { chunkSize }),
    ...(totalChunkCount !== undefined && { totalChunkCount }),
  };

  // ── Call TikTok Content Posting API — inbox upload init ───────────────────
  // access_token is used here server-side only; never logged, never returned.
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
        body: JSON.stringify({ source_info: sourceInfo }),
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

  // ── Return safe fields only ────────────────────────────────────────────────
  // upload_url, access_token, and refresh_token are intentionally absent.
  return json({
    ok: binaryUploadAttempted ? binaryUploadOk === true : true,
    ...diagnostics,
    tikTokStatus: 200,
    ...(tikTokData.data?.publish_id !== undefined && { publishId: tikTokData.data.publish_id }),
    uploadUrlReceived,
    binaryUploadAttempted,
    ...(binaryUploadAttempted && { binaryUploadStatus }),
    ...(binaryUploadAttempted && { binaryUploadOk }),
    ...(tikTokData.error?.log_id !== undefined && { tikTokLogId: tikTokData.error.log_id }),
  });
});
