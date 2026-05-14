import { useEffect, useRef, useState } from 'react';
import './App.css';

const TIKTOK_AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPE = 'user.info.basic,video.publish';
const SESSION_STATE_KEY = 'tiktok_oauth_state';
const EDGE_FUNCTION_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-token-exchange';
const PUBLISH_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-publish-video';
const STATUS_CHECK_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-status-check';
const CREATOR_INFO_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-creator-info';
const DEMO_VIDEO_URL =
  'https://potucky.github.io/creatorflow-studio/test-videos/creatorflow-review-demo.mp4';
const DEMO_VIDEO_LABEL = 'creatorflow-review-demo.mp4';
const DEFAULT_TITLE = 'Creator video upload';
const GOOGLE_SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbztz1c-8Hy4pk6mQ8CYBWYXCoTPmmcJXnJ77GVk4w8mVs0-Kt2PA_uQ0sN-msEyx73I8w/exec';

// 500 MB — validate before sending to the edge function
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

interface CallbackResult {
  code: string | null;
  returnedState: string | null;
  savedState: string | null;
  error: string | null;
  errorDescription: string | null;
}

// Safe fields only — access_token and refresh_token are intentionally absent
interface TokenExchangeResult {
  ok: boolean;
  tokenReceived?: boolean;
  openIdReceived?: boolean;
  openId?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  expiresIn?: number | null;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  error?: string;
  error_description?: string | null;
  log_id?: string | null;
}

// Safe fields only — upload_url, access_token, refresh_token intentionally absent
interface PublishResult {
  ok?: boolean;
  publishId?: string | null;
  binaryUploadOk?: boolean | null;
  binaryUploadStatus?: string | null;
  statusCheckOk?: boolean | null;
  publishStatus?: string | null;
  uploadedBytes?: number | null;
  error?: string;
  tikTokErrorCode?: string;
  tikTokErrorMessage?: string;
  connectionOpenIdMasked?: string | null;
  connectionScope?: string | null;
  connectionLastTokenExchangeAt?: string | null;
  connectionFound?: boolean | null;
  tokenAvailable?: boolean | null;
  openIdPresent?: boolean | null;
  connectionDisplayName?: string | null;
  connectionUsername?: string | null;
}

interface CreatorInfoResult {
  ok: boolean;
  creatorInfoAvailable?: boolean;
  creator_avatar_url?: string | null;
  creator_username?: string | null;
  creator_nickname?: string | null;
  privacy_level_options?: string[] | null;
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number | null;
  can_post?: boolean | null;
  tikTokErrorCode?: string;
  tikTokErrorMessage?: string;
  tikTokLogId?: string | null;
  error?: string;
}

// Safe fields only — access_token intentionally absent
interface StatusRefreshResult {
  ok: boolean;
  statusCheckOk?: boolean;
  publishId?: string | null;
  publishStatus?: string | null;
  failReason?: string | null;
  uploadedBytes?: number | null;
  tikTokErrorCode?: string;
  tikTokErrorMessage?: string;
  error?: string;
  connectionOpenIdMasked?: string | null;
  connectionScope?: string | null;
  connectionLastTokenExchangeAt?: string | null;
  connectionFound?: boolean | null;
  tokenAvailable?: boolean | null;
  openIdPresent?: boolean | null;
  connectionDisplayName?: string | null;
  connectionUsername?: string | null;
}

type ExchangeStatus = 'idle' | 'loading' | 'done' | 'skipped';
type PublishStatus = 'idle' | 'loading' | 'done';
type StatusRefreshState = 'idle' | 'loading' | 'done';
type CreatorInfoStatus = 'idle' | 'loading' | 'done' | 'error';
type SheetSyncStatus = 'idle' | 'loading' | 'saved' | 'failed';

function maskClientKey(key: string): string {
  if (key.length <= 8) return key.slice(0, 2) + '...' + key.slice(-2);
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildAuthUrl(clientKey: string, redirectUri: string): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(SESSION_STATE_KEY, state);
  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `${TIKTOK_AUTH_BASE}?${params.toString()}`;
}

function parseCallback(): CallbackResult | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;
  return {
    code,
    returnedState: params.get('state'),
    savedState: sessionStorage.getItem(SESSION_STATE_KEY),
    error,
    errorDescription: params.get('error_description'),
  };
}

function App() {
  const path = window.location.pathname;
  const [callbackResult] = useState<CallbackResult | null>(parseCallback);
  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus>(() => {
    const cb = parseCallback();
    if (!cb?.code) return 'idle';
    const valid =
      cb.returnedState !== null &&
      cb.savedState !== null &&
      cb.returnedState === cb.savedState;
    return valid ? 'loading' : 'skipped';
  });
  const [tokenResult, setTokenResult] = useState<TokenExchangeResult | null>(null);

  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [consent, setConsent] = useState(false);
  const [publishState, setPublishState] = useState<PublishStatus>('idle');
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<SheetSyncStatus>('idle');
  const [statusRefreshState, setStatusRefreshState] = useState<StatusRefreshState>('idle');
  const [statusRefreshResult, setStatusRefreshResult] = useState<StatusRefreshResult | null>(null);
  const [statusRefreshSheetSync, setStatusRefreshSheetSync] = useState<SheetSyncStatus>('idle');
  const [creatorInfoStatus, setCreatorInfoStatus] = useState<CreatorInfoStatus>('idle');
  const [creatorInfoResult, setCreatorInfoResult] = useState<CreatorInfoResult | null>(null);
  const [selectedPrivacy, setSelectedPrivacy] = useState('');
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [musicConfirmation, setMusicConfirmation] = useState(false);
  const [disclosureEnabled, setDisclosureEnabled] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);

  // Selected local video file for publish; null = use fallback demo video
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track the current object URL so it can be revoked before creating a new one
  const selectedPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (path.includes('/terms')) {
      document.title = 'CreatorFlow Studio | Terms';
    } else if (path.includes('/privacy')) {
      document.title = 'CreatorFlow Studio | Privacy';
    } else {
      document.title = 'CreatorFlow Studio';
    }
  }, [path]);

  useEffect(() => {
    if (!callbackResult?.code) return;

    const stateValid =
      callbackResult.returnedState !== null &&
      callbackResult.savedState !== null &&
      callbackResult.returnedState === callbackResult.savedState;

    if (!stateValid) return;

    fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: callbackResult.code,
        state: callbackResult.returnedState,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        const result = data as TokenExchangeResult;
        setTokenResult(result);
        if (result.ok) {
          setCreatorInfoStatus('loading');
          fetch(CREATOR_INFO_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ open_id: result.openId ?? undefined }),
          })
            .then((r) => r.json())
            .then((d) => {
              const ci = d as CreatorInfoResult;
              setCreatorInfoResult(ci);
              setCreatorInfoStatus(ci.ok ? 'done' : 'error');
            })
            .catch(() => {
              setCreatorInfoResult({ ok: false, error: 'Network error — could not reach creator info endpoint.' });
              setCreatorInfoStatus('error');
            });
        }
      })
      .catch(() =>
        setTokenResult({
          ok: false,
          error: 'Network error',
          error_description: 'Failed to reach the token exchange endpoint.',
          log_id: null,
        }),
      )
      .finally(() => setExchangeStatus('done'));
  }, [callbackResult]);

  // Revoke the object URL on unmount to avoid memory leaks
  useEffect(() => {
    const urlRef = selectedPreviewUrlRef;
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY as string | undefined;
  const redirectUri = import.meta.env.VITE_TIKTOK_REDIRECT_URI as string | undefined;
  const missingConfig = !clientKey || !redirectUri;

  function handleConnect() {
    if (!clientKey || !redirectUri) return;
    window.location.href = buildAuthUrl(clientKey, redirectUri);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (selectedPreviewUrlRef.current) {
      URL.revokeObjectURL(selectedPreviewUrlRef.current);
      selectedPreviewUrlRef.current = null;
    }
    if (!file) {
      setSelectedFile(null);
      setSelectedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    selectedPreviewUrlRef.current = url;
    setSelectedFile(file);
    setSelectedPreviewUrl(url);
  }

  function clearSelectedFile() {
    if (selectedPreviewUrlRef.current) {
      URL.revokeObjectURL(selectedPreviewUrlRef.current);
      selectedPreviewUrlRef.current = null;
    }
    setSelectedFile(null);
    setSelectedPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function logToGoogleSheet(
    result: PublishResult,
    videoTitle: string,
    notes = '',
    videoSource = DEMO_VIDEO_URL,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const payload = {
      ok: result.ok ?? null,
      binaryUploadOk: result.binaryUploadOk ?? null,
      binaryUploadStatus: result.binaryUploadStatus ?? null,
      statusCheckOk: result.statusCheckOk ?? null,
      publishStatus: result.publishStatus ?? null,
      videoTitle,
      publishId: result.publishId ?? null,
      uploadedBytes: result.uploadedBytes ?? null,
      environment: 'production',
      videoUrl: videoSource,
      errorMessage: result.error ?? null,
      connectionOpenIdMasked: result.connectionOpenIdMasked ?? null,
      connectionScope: result.connectionScope ?? null,
      connectionLastTokenExchangeAt: result.connectionLastTokenExchangeAt ?? null,
      connectionFound: result.connectionFound ?? null,
      tokenAvailable: result.tokenAvailable ?? null,
      openIdPresent: result.openIdPresent ?? null,
      createdAt: now,
      updatedAt: now,
      notes,
    };
    try {
      const res = await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function handlePublish() {
    // Validate file size before sending
    if (selectedFile && selectedFile.size > MAX_VIDEO_BYTES) {
      setPublishResult({
        ok: false,
        error: `Selected file is too large (${formatFileSize(selectedFile.size)}). Maximum allowed size is ${formatFileSize(MAX_VIDEO_BYTES)}.`,
      });
      setPublishState('done');
      return;
    }

    setPublishState('loading');
    setPublishResult(null);
    setSheetSyncStatus('idle');

    let result: PublishResult;
    try {
      let res: Response;
      if (selectedFile) {
        // Send selected local file as multipart/form-data so the edge function
        // can upload the bytes directly to TikTok without needing a public URL.
        const fd = new FormData();
        if (tokenResult?.openId) fd.append('open_id', tokenResult.openId);
        fd.append('upload_mode', 'FILE_UPLOAD');
        fd.append('upload_binary', 'true');
        fd.append('check_status', 'true');
        fd.append('title', title);
        fd.append('privacy_level', selectedPrivacy || 'SELF_ONLY');
        fd.append('disable_comment', String(!allowComment));
        fd.append('disable_duet', String(!allowDuet));
        fd.append('disable_stitch', String(!allowStitch));
        fd.append('brand_content_toggle', String(disclosureEnabled));
        fd.append('brand_organic_toggle', String(disclosureEnabled && yourBrand));
        fd.append('branded_content_toggle', String(disclosureEnabled && brandedContent && selectedPrivacy !== 'SELF_ONLY'));
        fd.append('video', selectedFile, selectedFile.name);
        res = await fetch(PUBLISH_URL, { method: 'POST', body: fd });
      } else {
        // Fallback: use the hosted demo video URL (server-side download)
        res = await fetch(PUBLISH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            open_id: tokenResult?.openId ?? undefined,
            upload_mode: 'FILE_UPLOAD',
            upload_binary: true,
            check_status: true,
            video_url: DEMO_VIDEO_URL,
            title,
            privacy_level: selectedPrivacy || 'SELF_ONLY',
            disable_comment: !allowComment,
            disable_duet: !allowDuet,
            disable_stitch: !allowStitch,
            brand_content_toggle: disclosureEnabled,
            brand_organic_toggle: disclosureEnabled && yourBrand,
            branded_content_toggle: disclosureEnabled && brandedContent && selectedPrivacy !== 'SELF_ONLY',
          }),
        });
      }
      const data = await res.json();
      result = data as PublishResult;
    } catch {
      result = { ok: false, error: 'Network error — could not reach publish endpoint.' };
    }
    setPublishResult(result);
    setPublishState('done');
    setStatusRefreshState('idle');
    setStatusRefreshResult(null);
    setStatusRefreshSheetSync('idle');

    const videoSource = selectedFile ? selectedFile.name : DEMO_VIDEO_URL;
    setSheetSyncStatus('loading');
    logToGoogleSheet(result, title, '', videoSource)
      .then((synced) => setSheetSyncStatus(synced ? 'saved' : 'failed'))
      .catch(() => setSheetSyncStatus('failed'));
  }

  async function handleRefreshStatus() {
    const publishId = publishResult?.publishId;
    if (!publishId) return;

    setStatusRefreshState('loading');
    setStatusRefreshResult(null);
    setStatusRefreshSheetSync('idle');

    let result: StatusRefreshResult;
    try {
      const res = await fetch(STATUS_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open_id: tokenResult?.openId ?? undefined,
          publish_id: publishId,
        }),
      });
      const data = await res.json();
      result = data as StatusRefreshResult;
    } catch {
      result = { ok: false, error: 'Network error — could not reach status check endpoint.' };
    }
    setStatusRefreshResult(result);
    setStatusRefreshState('done');

    setStatusRefreshSheetSync('loading');
    const asPublishResult: PublishResult = {
      ok: result.ok,
      publishId: result.publishId,
      statusCheckOk: result.statusCheckOk,
      publishStatus: result.publishStatus,
      uploadedBytes: result.uploadedBytes,
      error: result.error,
      connectionOpenIdMasked: result.connectionOpenIdMasked,
      connectionScope: result.connectionScope,
      connectionLastTokenExchangeAt: result.connectionLastTokenExchangeAt,
      connectionFound: result.connectionFound,
      tokenAvailable: result.tokenAvailable,
      openIdPresent: result.openIdPresent,
    };
    const videoSource = selectedFile ? selectedFile.name : DEMO_VIDEO_URL;
    logToGoogleSheet(asPublishResult, title, 'status_refresh', videoSource)
      .then((synced) => setStatusRefreshSheetSync(synced ? 'saved' : 'failed'))
      .catch(() => setStatusRefreshSheetSync('failed'));
  }

  async function handleLoadCreatorInfo() {
    setCreatorInfoStatus('loading');
    setCreatorInfoResult(null);
    setSelectedPrivacy('');
    setAllowComment(false);
    setAllowDuet(false);
    setAllowStitch(false);
    try {
      const res = await fetch(CREATOR_INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open_id: tokenResult?.openId ?? undefined }),
      });
      const data = await res.json();
      const result = data as CreatorInfoResult;
      setCreatorInfoResult(result);
      setCreatorInfoStatus(result.ok ? 'done' : 'error');
    } catch {
      setCreatorInfoResult({ ok: false, error: 'Network error — could not reach creator info endpoint.' });
      setCreatorInfoStatus('error');
    }
  }

  if (path.includes('/terms')) {
    return (
      <main className="page">
        <section className="card">
          <div className="page-header-row">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
            <span className="brand-name">CreatorFlow Studio</span>
          </div>
          <hr className="brand-divider" />
          <h1>Terms of Service</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Purpose</h2>
          <p>
            CreatorFlow Studio is a creator tool intended to help the account
            owner connect their own TikTok account, review their creator-owned videos,
            and send them to TikTok for publishing through TikTok's official Content
            Posting API.
          </p>

          <h2>Authorized Use</h2>
          <p>
            The application may only be used by the authorized account owner for
            content that they own or have permission to publish.
          </p>

          <h2>Prohibited Use</h2>
          <p>
            The application must not be used for scraping, spam, artificial engagement,
            unauthorized posting, impersonation, misleading activity, or any activity
            that violates TikTok's policies or applicable law.
          </p>

          <h2>User Responsibility</h2>
          <p>
            The user is responsible for reviewing all content, captions, and publishing
            settings before posting.
          </p>

          <a href={import.meta.env.BASE_URL}>Back to home</a>
        </section>
      </main>
    );
  }

  if (path.includes('/privacy')) {
    return (
      <main className="page">
        <section className="card">
          <div className="page-header-row">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
            <span className="brand-name">CreatorFlow Studio</span>
          </div>
          <hr className="brand-divider" />
          <h1>Privacy Policy</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Overview</h2>
          <p>
            CreatorFlow Studio is a creator tool that helps the account owner connect
            their own TikTok account and send creator-owned short-form videos to TikTok
            for review and publishing through TikTok's official Content Posting API.
          </p>

          <h2>Information We May Access</h2>
          <p>
            With user authorization, the application may access basic TikTok account
            information and permissions required to publish video content.
          </p>

          <h2>How Information Is Used</h2>
          <p>
            Information is used only to authenticate the account owner and perform
            authorized content publishing actions through TikTok's API.
          </p>

          <h2>Data Sharing</h2>
          <p>
            The application does not sell personal information. Data is not shared with
            third parties except as required to operate the integration with TikTok's API.
          </p>

          <h2>Data Storage</h2>
          <p>
            API credentials and access tokens must be stored securely and must not be
            exposed publicly or committed to public repositories.
          </p>

          <a href={import.meta.env.BASE_URL}>Back to home</a>
        </section>
      </main>
    );
  }

  // Derived display values for dashboard
  const connectedOpenId =
    publishResult?.connectionOpenIdMasked ??
    statusRefreshResult?.connectionOpenIdMasked ??
    (tokenResult?.ok && tokenResult.openId ? maskClientKey(tokenResult.openId) : null);
  const isConnected =
    tokenResult?.ok === true ||
    publishResult?.connectionFound === true ||
    statusRefreshResult?.connectionFound === true;
  const displayStatus =
    statusRefreshResult?.publishStatus ?? publishResult?.publishStatus ?? null;
  const isComplete = displayStatus === 'PUBLISH_COMPLETE';

  const connectedDisplayName =
    publishResult?.connectionDisplayName ??
    statusRefreshResult?.connectionDisplayName ??
    tokenResult?.displayName ?? null;
  const connectedUsername =
    publishResult?.connectionUsername ??
    statusRefreshResult?.connectionUsername ??
    tokenResult?.username ?? null;
  const lastTokenExchange =
    publishResult?.connectionLastTokenExchangeAt ??
    statusRefreshResult?.connectionLastTokenExchangeAt ?? null;
  const headerChipLabel =
    connectedUsername
      ? `@${connectedUsername}`
      : connectedDisplayName ?? connectedOpenId ?? 'TikTok Connected';

  const creatorInfoLoaded = creatorInfoStatus === 'done' && creatorInfoResult?.ok === true;
  const cannotPostNow = creatorInfoLoaded && creatorInfoResult?.can_post === false;
  const disclosureInvalid = disclosureEnabled && !yourBrand && !brandedContent;
  const brandedContentPrivacyConflict = brandedContent && selectedPrivacy === 'SELF_ONLY';
  const publishDisabled =
    publishState === 'loading' ||
    !consent ||
    !musicConfirmation ||
    !creatorInfoLoaded ||
    cannotPostNow ||
    !selectedPrivacy ||
    !title.trim() ||
    disclosureInvalid ||
    brandedContentPrivacyConflict;

  return (
    <main className="page dash-page">
      {/* ── Compact header ── */}
      <header className="dash-header">
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="CreatorFlow Studio"
          className="dash-icon"
        />
        <div className="dash-brand">
          <span className="dash-name">CreatorFlow Studio</span>
          <span className="dash-subtitle">TikTok Content Publishing</span>
        </div>

        <div className="dash-acct">
          {isConnected ? (
            <span className="acct-chip acct-chip--ok">
              <span className="acct-dot" />
              {headerChipLabel}
            </span>
          ) : (
            <span className="acct-chip acct-chip--idle">Not connected</span>
          )}
        </div>

        <nav className="dash-nav">
          <a href={`${import.meta.env.BASE_URL}terms/`}>Terms</a>
          <a href={`${import.meta.env.BASE_URL}privacy/`}>Privacy</a>
        </nav>
      </header>

      {/* ── 3-column dashboard ── */}
      <div className="dashboard">

        {/* LEFT — TikTok Connection */}
        <section className="card dash-card tt-section">
          <h2 className="dash-card-h2">TikTok Connection</h2>

          <div className="tt-status-row">
            <span className="tt-label">Status</span>
            <span className={`tt-badge ${isConnected ? 'tt-ok' : 'tt-warn'}`}>
              {isConnected ? 'connected' : 'not connected'}
            </span>
          </div>

          {connectedOpenId && connectedDisplayName && (
            <div className="tt-meta-row">
              <span className="tt-label">Account</span>
              <span className="tt-code">{connectedDisplayName}</span>
            </div>
          )}

          {connectedOpenId && connectedUsername && (
            <div className="tt-meta-row">
              <span className="tt-label">Username</span>
              <span className="tt-code">@{connectedUsername}</span>
            </div>
          )}

          {connectedOpenId && !connectedUsername && !connectedDisplayName && (
            <p className="dash-note dash-mt-xs">
              TikTok username is not returned yet; using masked open_id.
            </p>
          )}

          {connectedOpenId && (
            <div className="tt-meta-row">
              <span className="tt-label">Connection ID</span>
              <span className="tt-code">{connectedOpenId}</span>
            </div>
          )}

          {clientKey && (
            <div className="tt-meta-row">
              <span className="tt-label">TikTok Client Key</span>
              <span className="tt-code">{maskClientKey(clientKey)}</span>
            </div>
          )}

          {(publishResult?.connectionScope ?? statusRefreshResult?.connectionScope ?? tokenResult?.scope) && (
            <div className="tt-meta-row">
              <span className="tt-label">Scope</span>
              <span className="tt-code">
                {publishResult?.connectionScope ?? statusRefreshResult?.connectionScope ?? tokenResult?.scope}
              </span>
            </div>
          )}

          {lastTokenExchange && (
            <div className="tt-meta-row">
              <span className="tt-label">Last exchange</span>
              <span className="tt-value">{new Date(lastTokenExchange).toLocaleString()}</span>
            </div>
          )}

          <button
            type="button"
            className="tt-btn dash-btn"
            onClick={handleConnect}
            disabled={missingConfig}
          >
            Connect TikTok
          </button>

          {missingConfig && (
            <p className="dash-note dash-note--warn dash-mt-sm">
              VITE_TIKTOK_CLIENT_KEY or VITE_TIKTOK_REDIRECT_URI not set.
            </p>
          )}

          {callbackResult && (
            <details className="dash-details dash-mt-sm">
              <summary className="dash-details-summary">OAuth Callback</summary>
              <div className="dash-details-body">
                <div className="tt-status-row">
                  <span className="tt-label">Code</span>
                  <span className={`tt-badge ${callbackResult.code ? 'tt-ok' : 'tt-fail'}`}>
                    {callbackResult.code ? 'present' : 'missing'}
                  </span>
                </div>

                <div className="tt-status-row">
                  <span className="tt-label">State</span>
                  {callbackResult.returnedState === null ? (
                    <span className="tt-badge tt-warn">not returned</span>
                  ) : callbackResult.savedState === null ? (
                    <span className="tt-badge tt-warn">no saved state</span>
                  ) : callbackResult.returnedState === callbackResult.savedState ? (
                    <span className="tt-badge tt-ok">matches</span>
                  ) : (
                    <span className="tt-badge tt-fail">mismatch</span>
                  )}
                </div>

                {callbackResult.error && (
                  <div className="tt-status-row">
                    <span className="tt-label">Error</span>
                    <span className="tt-badge tt-fail">{callbackResult.error}</span>
                  </div>
                )}

                {callbackResult.errorDescription && (
                  <p className="dash-note dash-note--fail dash-mt-xs">
                    {callbackResult.errorDescription}
                  </p>
                )}

                <p className="dash-note dash-mt-sm">
                  Authorizing via TikTok OAuth. No credentials stored in browser.
                </p>
              </div>
            </details>
          )}

          {exchangeStatus !== 'idle' && (
            <details className="dash-details dash-mt-sm">
              <summary className="dash-details-summary">
                Token Exchange
                {exchangeStatus === 'loading' && (
                  <span className="dash-details-chip"> — loading…</span>
                )}
                {exchangeStatus === 'done' && tokenResult && (
                  <span className={`dash-details-chip${tokenResult.ok ? ' dash-details-chip--ok' : ' dash-details-chip--fail'}`}>
                    {' '}— {tokenResult.ok ? 'ok' : 'error'}
                  </span>
                )}
              </summary>
              <div className="dash-details-body">
                {exchangeStatus === 'skipped' && (
                  <p className="dash-note dash-note--warn">State mismatch — token exchange skipped.</p>
                )}

                {exchangeStatus === 'loading' && (
                  <p className="tt-exchange-loading">Exchanging token with backend…</p>
                )}

                {exchangeStatus === 'done' && tokenResult && (
                  <>
                    <div className="tt-status-row">
                      <span className="tt-label">Result</span>
                      <span className={`tt-badge ${tokenResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                        {tokenResult.ok ? 'ok' : 'error'}
                      </span>
                    </div>

                    {tokenResult.ok ? (
                      <>
                        <div className="tt-status-row">
                          <span className="tt-label">Token</span>
                          <span className={`tt-badge ${tokenResult.tokenReceived ? 'tt-ok' : 'tt-fail'}`}>
                            {tokenResult.tokenReceived ? 'received' : 'missing'}
                          </span>
                        </div>
                        <div className="tt-status-row">
                          <span className="tt-label">Open ID</span>
                          <span className={`tt-badge ${tokenResult.openIdReceived ? 'tt-ok' : 'tt-fail'}`}>
                            {tokenResult.openIdReceived ? 'received' : 'missing'}
                          </span>
                        </div>
                        {tokenResult.expiresIn != null && (
                          <div className="tt-meta-row">
                            <span className="tt-label">Expires in</span>
                            <span className="tt-value">{tokenResult.expiresIn}s</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {tokenResult.error && (
                          <p className="dash-note dash-note--fail dash-mt-xs">
                            {tokenResult.error}
                          </p>
                        )}
                        {tokenResult.error_description && (
                          <p className="dash-note dash-note--fail dash-mt-xs">
                            {tokenResult.error_description}
                          </p>
                        )}
                        {tokenResult.log_id && (
                          <div className="tt-meta-row">
                            <span className="tt-label">Log ID</span>
                            <span className="tt-code">{tokenResult.log_id}</span>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </details>
          )}

          {!callbackResult && exchangeStatus === 'idle' && (
            <details className="dash-details dash-mt-sm">
              <summary className="dash-details-summary">OAuth Security</summary>
              <div className="dash-details-body">
                <p className="dash-note">
                  Connects securely via TikTok OAuth. No credentials stored in browser.
                </p>
              </div>
            </details>
          )}
        </section>

        {/* CENTER — Publish Video */}
        <section className="card dash-card tt-section">
          <h2 className="dash-card-h2">Publish Video</h2>

          {/* Video preview */}
          <div className="dash-video-wrap">
            <video
              key={selectedPreviewUrl ?? 'demo'}
              src={selectedPreviewUrl ?? `${import.meta.env.BASE_URL}test-videos/creatorflow-review-demo.mp4`}
              controls
              className="dash-video"
            />
            <div className="dash-video-name">
              {selectedFile ? selectedFile.name : `${DEMO_VIDEO_LABEL} (demo)`}
            </div>
            {selectedFile && (
              <div className="dash-video-size">{formatFileSize(selectedFile.size)}</div>
            )}
          </div>

          {/* File picker controls */}
          <div className="dash-video-picker">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4"
              aria-label="Choose MP4 video file"
              className="dash-file-input-hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="tt-btn-secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose video
            </button>
            {selectedFile && (
              <button
                type="button"
                className="tt-btn-secondary"
                onClick={clearSelectedFile}
              >
                Use demo video
              </button>
            )}
          </div>

          <div className="tt-field-row dash-mt-xs">
            <label className="tt-label" htmlFor="publish-title">Title</label>
            <input
              id="publish-title"
              className="tt-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <hr className="tt-divider" />

          {/* ── Creator Info ── */}
          <div className="dash-sub-label">Creator &amp; Privacy</div>

          {creatorInfoStatus === 'idle' && (
            <div className="creator-info-idle">
              <p className="dash-note dash-note--warn">
                Creator info is required before publishing.
              </p>
              <button
                type="button"
                className="tt-btn-secondary dash-mt-xs"
                onClick={handleLoadCreatorInfo}
              >
                Load Creator Info
              </button>
            </div>
          )}

          {creatorInfoStatus === 'loading' && (
            <p className="tt-exchange-loading">Loading creator info from TikTok…</p>
          )}

          {creatorInfoStatus === 'error' && (
            <div className="creator-info-idle">
              <p className="dash-note dash-note--fail">
                {creatorInfoResult?.error ?? 'Creator info could not be loaded. Reconnect TikTok or try again.'}
              </p>
              <button
                type="button"
                className="tt-btn-secondary dash-mt-xs"
                onClick={handleLoadCreatorInfo}
              >
                Retry
              </button>
            </div>
          )}

          {cannotPostNow && (
            <p className="dash-note dash-note--warn dash-mt-xs">
              TikTok says this creator cannot post right now. Please try again later.
            </p>
          )}

          {creatorInfoStatus === 'done' && creatorInfoResult?.ok && !cannotPostNow && (
            <div className="creator-info-panel">
              <div className="creator-info-identity">
                {creatorInfoResult.creator_avatar_url && (
                  <img
                    src={creatorInfoResult.creator_avatar_url}
                    alt="Creator avatar"
                    className="creator-avatar"
                  />
                )}
                <div className="creator-identity-text">
                  {creatorInfoResult.creator_nickname && (
                    <div className="creator-nickname">{creatorInfoResult.creator_nickname}</div>
                  )}
                  {creatorInfoResult.creator_username && (
                    <div className="creator-username-label">@{creatorInfoResult.creator_username}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="tt-btn-secondary creator-info-reload"
                  onClick={handleLoadCreatorInfo}
                  title="Reload creator info"
                >
                  ↻
                </button>
              </div>
              {creatorInfoResult.max_video_post_duration_sec != null && (
                <div className="tt-meta-row dash-mt-xs">
                  <span className="tt-label">Max duration</span>
                  <span className="tt-value">{creatorInfoResult.max_video_post_duration_sec}s</span>
                </div>
              )}
            </div>
          )}

          {/* ── Privacy dropdown ── */}
          <div className="tt-field-row dash-mt-xs">
            <label className="tt-label" htmlFor="privacy-select">Privacy</label>
            <select
              id="privacy-select"
              className="tt-select"
              value={selectedPrivacy}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedPrivacy(v);
                if (v === 'SELF_ONLY') setBrandedContent(false);
              }}
              disabled={!creatorInfoLoaded}
            >
              <option value="">— select privacy —</option>
              {(creatorInfoResult?.privacy_level_options ?? []).map((opt) => (
                <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {creatorInfoLoaded && !selectedPrivacy && (
            <p className="field-hint">
              Available privacy options are provided by TikTok for the connected account.
            </p>
          )}

          <hr className="tt-divider" />

          {/* ── Interaction Controls ── */}
          <div className="dash-sub-label">Interaction Controls</div>

          <label className={`tt-consent${creatorInfoResult?.comment_disabled ? ' tt-consent--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={allowComment}
              disabled={!!creatorInfoResult?.comment_disabled}
              onChange={(e) => setAllowComment(e.target.checked)}
            />
            Allow comments
            {creatorInfoResult?.comment_disabled && (
              <span className="interaction-note">— disabled on this account</span>
            )}
          </label>

          <label className={`tt-consent${creatorInfoResult?.duet_disabled ? ' tt-consent--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={allowDuet}
              disabled={!!creatorInfoResult?.duet_disabled}
              onChange={(e) => setAllowDuet(e.target.checked)}
            />
            Allow duet
            {creatorInfoResult?.duet_disabled && (
              <span className="interaction-note">— disabled on this account</span>
            )}
          </label>

          <label className={`tt-consent${creatorInfoResult?.stitch_disabled ? ' tt-consent--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={allowStitch}
              disabled={!!creatorInfoResult?.stitch_disabled}
              onChange={(e) => setAllowStitch(e.target.checked)}
            />
            Allow stitch
            {creatorInfoResult?.stitch_disabled && (
              <span className="interaction-note">— disabled on this account</span>
            )}
          </label>

          <hr className="tt-divider" />

          {/* ── Commercial Content Disclosure ── */}
          <div className="dash-sub-label">Commercial Content Disclosure</div>

          <div
            className="disclosure-toggle-row"
            role="switch"
            aria-checked={disclosureEnabled ? 'true' : 'false'}
            tabIndex={0}
            onClick={() => {
              const next = !disclosureEnabled;
              setDisclosureEnabled(next);
              if (!next) { setYourBrand(false); setBrandedContent(false); }
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                const next = !disclosureEnabled;
                setDisclosureEnabled(next);
                if (!next) { setYourBrand(false); setBrandedContent(false); }
              }
            }}
          >
            <span className="disclosure-toggle-label">
              This content promotes myself, a brand, product, or service
            </span>
            <span className="disclosure-switch-wrap">
              <span className={`disclosure-switch-track${disclosureEnabled ? ' disclosure-switch-track--on' : ''}`}>
                <span className="disclosure-switch-knob" />
              </span>
              <span className={`disclosure-switch-state${disclosureEnabled ? ' disclosure-switch-state--on' : ''}`}>
                {disclosureEnabled ? 'On' : 'Off'}
              </span>
            </span>
          </div>

          {disclosureEnabled && (
            <div className={`disclosure-options${disclosureInvalid ? ' disclosure-options--warn' : ''}`}>
              <label className="tt-consent">
                <input
                  type="checkbox"
                  checked={yourBrand}
                  onChange={(e) => setYourBrand(e.target.checked)}
                />
                Your brand
              </label>
              {yourBrand && !brandedContent && (
                <p className="disclosure-hint">Your photo/video will be labeled as &lsquo;Promotional content&rsquo;</p>
              )}

              <label className={`tt-consent${selectedPrivacy === 'SELF_ONLY' ? ' tt-consent--disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={brandedContent}
                  disabled={selectedPrivacy === 'SELF_ONLY'}
                  onChange={(e) => setBrandedContent(e.target.checked)}
                />
                Branded content
                {selectedPrivacy === 'SELF_ONLY' && (
                  <span className="interaction-note">— Branded content visibility cannot be set to private.</span>
                )}
              </label>
              {brandedContent && (
                <p className="disclosure-hint">Your photo/video will be labeled as &lsquo;Paid partnership&rsquo;</p>
              )}

              {disclosureInvalid && (
                <p className="field-hint field-hint--warn disclosure-warn-text">
                  You need to indicate if your content promotes yourself, a third party, or both.
                </p>
              )}
            </div>
          )}

          <hr className="tt-divider" />

          {/* ── Consent ── */}
          <label className="tt-consent">
            <input
              type="checkbox"
              checked={musicConfirmation}
              onChange={(e) => setMusicConfirmation(e.target.checked)}
            />
            By posting, you agree to TikTok&rsquo;s Music Usage Confirmation
          </label>

          <label className="tt-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I confirm I want to publish to my connected TikTok account.
          </label>

          <div>
            <button
              type="button"
              className="tt-btn dash-btn"
              onClick={handlePublish}
              disabled={publishDisabled}
            >
              {publishState === 'loading' ? 'Publishing…' : 'Publish to TikTok'}
            </button>
          </div>

          <p className="field-hint dash-mt-xs">
            After publishing, TikTok may take a few minutes to process the video before it appears on the profile.
          </p>

        </section>

        {/* RIGHT — Status */}
        <section className="card dash-card tt-section">
          <div className="dash-status-hdr">
            <h2 className="dash-card-h2 dash-card-h2--no-margin">Publish Status</h2>
            {publishResult?.publishId != null && (
              <button
                type="button"
                className="tt-btn-secondary dash-refresh-btn"
                onClick={handleRefreshStatus}
                disabled={statusRefreshState === 'loading'}
              >
                {statusRefreshState === 'loading' ? 'Checking…' : 'Refresh Status'}
              </button>
            )}
          </div>

          {publishState === 'idle' && (
            <>
              <div className="dash-sub-label dash-mt-xs">Audit Readiness</div>

              <div className="checklist-row">
                <span className="checklist-dot checklist-dot--pass" />
                <span className="checklist-text">Official website and brand visible</span>
              </div>
              <div className="checklist-row">
                <span className="checklist-dot checklist-dot--pass" />
                <span className="checklist-text">Terms and Privacy links in header</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${isConnected ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">TikTok OAuth connected</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${isConnected && (connectedDisplayName || connectedUsername || connectedOpenId) ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">Connected account identity visible</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${creatorInfoLoaded ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">Creator info loaded from TikTok</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${selectedPrivacy ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">Privacy manually selected from TikTok options</span>
              </div>
              <div className="checklist-row">
                <span className="checklist-dot checklist-dot--pass" />
                <span className="checklist-text">Interaction controls visible</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${musicConfirmation ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">Music Usage Confirmation agreed</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${!disclosureEnabled || yourBrand || brandedContent ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">Commercial disclosure handled</span>
              </div>
              <div className="checklist-row">
                <span className="checklist-dot checklist-dot--pass" />
                <span className="checklist-text">Video preview visible</span>
              </div>
              <div className="checklist-row">
                <span className={`checklist-dot ${consent ? 'checklist-dot--pass' : 'checklist-dot--pending'}`} />
                <span className="checklist-text">User consent confirmed</span>
              </div>
              <div className="checklist-row">
                <span className="checklist-dot checklist-dot--pass" />
                <span className="checklist-text">Tokens stored server-side only</span>
              </div>

              <details className="dash-details dash-mt-sm">
                <summary className="dash-details-summary">Technical Details</summary>
                <div className="dash-details-body">
                  <div className="tt-meta-row">
                    <span className="tt-label">Environment</span>
                    <span className="tt-code">production</span>
                  </div>
                  <div className="tt-meta-row">
                    <span className="tt-label">Upload mode</span>
                    <span className="tt-code">FILE_UPLOAD</span>
                  </div>
                  <div className="tt-meta-row">
                    <span className="tt-label">Publish scope</span>
                    <span className="tt-code">video.publish</span>
                  </div>
                  <div className="tt-meta-row">
                    <span className="tt-label">Safe mode</span>
                    <span className="tt-badge tt-ok">enabled</span>
                  </div>
                </div>
              </details>

              <p className="dash-note dash-mt-sm">
                CreatorFlow Studio is an independent creator tool and is not affiliated with or endorsed by TikTok.
              </p>
            </>
          )}

          {publishState === 'loading' && (
            <p className="tt-exchange-loading dash-mt">Publishing video…</p>
          )}

          {publishState === 'done' && publishResult && (
            <>
              <div className="tt-status-row dash-mt">
                <span className="tt-label">API</span>
                <span className={`tt-badge ${publishResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                  {publishResult.ok ? 'ok' : 'error'}
                </span>
              </div>

              {displayStatus && (
                <div className="tt-status-row">
                  <span className="tt-label">Status</span>
                  <span className={`tt-badge ${
                    displayStatus === 'PUBLISH_COMPLETE' || displayStatus === 'SEND_TO_USER_INBOX'
                      ? 'tt-ok'
                      : displayStatus === 'FAILED'
                      ? 'tt-fail'
                      : 'tt-warn'
                  }`}>
                    {displayStatus}
                  </span>
                </div>
              )}

              <div className="tt-status-row">
                <span className="tt-label">Privacy</span>
                <span className="tt-code dash-privacy-val">{selectedPrivacy}</span>
              </div>

              {isComplete && (
                <>
                  <div className="dash-complete-msg">
                    <strong>Video published successfully.</strong>
                    <br />
                    {selectedPrivacy === 'SELF_ONLY'
                      ? 'Open TikTok → Profile → lock/private tab.'
                      : 'Open TikTok → Profile to view the published video.'}
                  </div>
                  <p className="field-hint dash-mt-xs">
                    TikTok may take a few minutes to process the video before it appears on the profile.
                  </p>
                </>
              )}

              {statusRefreshState === 'loading' && (
                <p className="tt-exchange-loading dash-mt-sm">Refreshing status…</p>
              )}

              {(publishResult.tikTokErrorCode === 'unaudited_client_can_only_post_to_private_accounts' ||
                statusRefreshResult?.tikTokErrorCode === 'unaudited_client_can_only_post_to_private_accounts') && (
                <p className="dash-note dash-note--warn dash-mt-sm">
                  TikTok requires the account to be set to Private with SELF_ONLY privacy for this publish attempt. Check your TikTok account privacy settings and try again.
                </p>
              )}

              {(publishResult.error ?? statusRefreshResult?.error) && (
                <p className="dash-note dash-note--fail dash-mt-sm">
                  {statusRefreshResult?.error ?? publishResult.error}
                </p>
              )}

              <details className="dash-details dash-mt">
                <summary className="dash-details-summary">Technical Details</summary>
                <div className="dash-details-body">
                  {(publishResult.publishId ?? statusRefreshResult?.publishId) && (
                    <div className="tt-meta-row">
                      <span className="tt-label">publishId</span>
                      <span className="tt-code">{publishResult.publishId ?? statusRefreshResult?.publishId}</span>
                    </div>
                  )}
                  {tokenResult?.log_id && (
                    <div className="tt-meta-row">
                      <span className="tt-label">TikTok log id</span>
                      <span className="tt-code">{tokenResult.log_id}</span>
                    </div>
                  )}
                  <div className="tt-meta-row">
                    <span className="tt-label">Upload mode</span>
                    <span className="tt-code">FILE_UPLOAD</span>
                  </div>
                  {publishResult.binaryUploadOk != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">Binary upload</span>
                      <span className={`tt-badge ${publishResult.binaryUploadOk ? 'tt-ok' : 'tt-fail'}`}>
                        {String(publishResult.binaryUploadOk)}
                      </span>
                    </div>
                  )}
                  {publishResult.binaryUploadStatus != null && (
                    <div className="tt-meta-row">
                      <span className="tt-label">Upload status</span>
                      <span className="tt-code">{publishResult.binaryUploadStatus}</span>
                    </div>
                  )}
                  {(statusRefreshResult?.uploadedBytes ?? publishResult.uploadedBytes) != null && (
                    <div className="tt-meta-row">
                      <span className="tt-label">Uploaded bytes</span>
                      <span className="tt-value">
                        {(statusRefreshResult?.uploadedBytes ?? publishResult.uploadedBytes)?.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {publishResult.statusCheckOk != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">Status check</span>
                      <span className={`tt-badge ${publishResult.statusCheckOk ? 'tt-ok' : 'tt-fail'}`}>
                        {String(publishResult.statusCheckOk)}
                      </span>
                    </div>
                  )}
                  {statusRefreshResult?.failReason && (
                    <div className="tt-meta-row">
                      <span className="tt-label">Fail reason</span>
                      <span className="tt-code">{statusRefreshResult.failReason}</span>
                    </div>
                  )}
                  {statusRefreshResult?.tikTokErrorCode && (
                    <div className="tt-meta-row">
                      <span className="tt-label">TikTok error</span>
                      <span className="tt-code">{statusRefreshResult.tikTokErrorCode}</span>
                    </div>
                  )}
                  {statusRefreshResult?.tikTokErrorMessage && (
                    <div className="tt-meta-row">
                      <span className="tt-label">TikTok msg</span>
                      <span className="tt-code">{statusRefreshResult.tikTokErrorMessage}</span>
                    </div>
                  )}
                  {(publishResult.connectionOpenIdMasked ?? statusRefreshResult?.connectionOpenIdMasked) && (
                    <div className="tt-meta-row">
                      <span className="tt-label">Connection ID</span>
                      <span className="tt-code">
                        {publishResult.connectionOpenIdMasked ?? statusRefreshResult?.connectionOpenIdMasked}
                      </span>
                    </div>
                  )}
                  {(publishResult.connectionScope ?? statusRefreshResult?.connectionScope) && (
                    <div className="tt-meta-row">
                      <span className="tt-label">Sheet saved</span>
                      <span className="tt-code">
                        {sheetSyncStatus === 'saved' || statusRefreshSheetSync === 'saved' ? 'yes' : 'no'}
                      </span>
                    </div>
                  )}
                </div>
              </details>

              {(sheetSyncStatus !== 'idle' || statusRefreshSheetSync !== 'idle') && (
                <p className={`tt-sheet-sync${
                  sheetSyncStatus === 'saved' || statusRefreshSheetSync === 'saved'
                    ? ' tt-sheet-sync--ok'
                    : sheetSyncStatus === 'failed' || statusRefreshSheetSync === 'failed'
                    ? ' tt-sheet-sync--fail'
                    : ''
                }`}>
                  Sheet:{' '}
                  {sheetSyncStatus === 'loading' || statusRefreshSheetSync === 'loading'
                    ? 'syncing…'
                    : sheetSyncStatus === 'saved' || statusRefreshSheetSync === 'saved'
                    ? 'saved'
                    : 'failed'}
                </p>
              )}
            </>
          )}
        </section>

      </div>
    </main>
  );
}

export default App;
