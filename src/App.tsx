import { useEffect, useState } from 'react';
import './App.css';

const TIKTOK_AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPE = 'user.info.basic,video.upload';
const SESSION_STATE_KEY = 'tiktok_oauth_state';
const EDGE_FUNCTION_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-token-exchange';
const PUBLISH_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-publish-video';
const STATUS_CHECK_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-status-check';
const TEST_VIDEO_URL =
  'https://potucky.github.io/creatorflow-studio/test-videos/tiktok-sandbox-tiny-test.mp4';
const DEFAULT_TITLE = 'Creator video upload';
const GOOGLE_SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbztz1c-8Hy4pk6mQ8CYBWYXCoTPmmcJXnJ77GVk4w8mVs0-Kt2PA_uQ0sN-msEyx73I8w/exec';

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
  connectionOpenIdMasked?: string | null;
  connectionScope?: string | null;
  connectionLastTokenExchangeAt?: string | null;
  connectionFound?: boolean | null;
  tokenAvailable?: boolean | null;
  openIdPresent?: boolean | null;
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
}

type ExchangeStatus = 'idle' | 'loading' | 'done' | 'skipped';
type PublishStatus = 'idle' | 'loading' | 'done';
type StatusRefreshState = 'idle' | 'loading' | 'done';
type SheetSyncStatus = 'idle' | 'loading' | 'saved' | 'failed';

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
  // Lazy init from URL params — no effect needed; URL params don't change after mount
  const [callbackResult] = useState<CallbackResult | null>(parseCallback);
  // Derive initial status synchronously — avoids any synchronous setState in effects
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
  const [demoState, setDemoState] = useState<'idle' | 'loading' | 'success'>('idle');

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
      .then((data) => setTokenResult(data as TokenExchangeResult))
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

  const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY as string | undefined;
  const redirectUri = import.meta.env.VITE_TIKTOK_REDIRECT_URI as string | undefined;
  const missingConfig = !clientKey || !redirectUri;

  function handleConnect() {
    if (!clientKey || !redirectUri) return;
    window.location.href = buildAuthUrl(clientKey, redirectUri);
  }

  async function logToGoogleSheet(result: PublishResult, videoTitle: string, notes = ''): Promise<boolean> {
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
      environment: 'sandbox',
      videoUrl: TEST_VIDEO_URL,
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
    setPublishState('loading');
    setPublishResult(null);
    setSheetSyncStatus('idle');
    let result: PublishResult;
    try {
      const res = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open_id: tokenResult?.openId ?? undefined,
          upload_mode: 'FILE_UPLOAD',
          upload_binary: true,
          check_status: true,
          video_url: TEST_VIDEO_URL,
          title,
          privacy_level: 'SELF_ONLY',
        }),
      });
      const data = await res.json();
      result = data as PublishResult;
    } catch {
      result = { ok: false, error: 'Network error — could not reach publish endpoint.' };
    }
    setPublishResult(result);
    setPublishState('done');
    // Reset any previous refresh when a new upload is done
    setStatusRefreshState('idle');
    setStatusRefreshResult(null);
    setStatusRefreshSheetSync('idle');

    // Fire-and-forget: must not block or affect the upload result
    setSheetSyncStatus('loading');
    logToGoogleSheet(result, title)
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

    // Fire-and-forget: log refresh result to Google Sheet
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
    logToGoogleSheet(asPublishResult, title, 'status_refresh')
      .then((synced) => setStatusRefreshSheetSync(synced ? 'saved' : 'failed'))
      .catch(() => setStatusRefreshSheetSync('failed'));
  }

  async function handleDemoSend() {
    setDemoState('loading');
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    setDemoState('success');
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
            information and permissions required to upload or publish video content.
          </p>

          <h2>How Information Is Used</h2>
          <p>
            Information is used only to authenticate the account owner and perform
            authorized content upload or publishing actions through TikTok's API.
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

  return (
    <main className="page">
      <section className="hero">
        <div className="app-header-row">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
          <h1>CreatorFlow Studio</h1>
        </div>
        <p>
          CreatorFlow Studio helps you connect your own TikTok account and send your
          creator-owned short-form videos to TikTok for review and publishing through
          TikTok's official Content Posting API.
        </p>

        <div className="links">
          <a href={`${import.meta.env.BASE_URL}terms/`}>Terms of Service</a>
          <a href={`${import.meta.env.BASE_URL}privacy/`}>Privacy Policy</a>
        </div>
      </section>

      <section className="card tt-section demo-section">
        <div className="demo-badge">Review Demo Mode</div>
        <h2>TikTok Integration Demo</h2>
        <p className="demo-desc">
          This section demonstrates the complete TikTok Content Posting API user flow for review purposes.
        </p>

        <hr className="tt-divider" />

        <h3 className="demo-sub">Step 1 — TikTok Connection</h3>
        <div className="demo-connection">
          <span className="demo-connected-dot" />
          <strong>TikTok Connected</strong>
          <span className="tt-badge tt-ok">demo</span>
        </div>
        <div className="tt-meta-row">
          <span className="tt-label">Account</span>
          <span className="tt-value">@creatorflow_demo</span>
        </div>
        <div className="tt-meta-row">
          <span className="tt-label">Permissions</span>
          <span className="tt-value">user.info.basic · video.upload</span>
        </div>

        <hr className="tt-divider" />

        <h3 className="demo-sub">Step 2 — Demo Video</h3>
        <div className="demo-video-card">
          <video
            src={`${import.meta.env.BASE_URL}test-videos/tiktok-sandbox-tiny-test.mp4`}
            controls
            className="demo-video"
          />
          <p className="demo-video-name">tiktok-sandbox-tiny-test.mp4</p>
        </div>

        <hr className="tt-divider" />

        <h3 className="demo-sub">Step 3 — Send to TikTok Inbox</h3>
        <button
          type="button"
          className="tt-btn"
          onClick={handleDemoSend}
          disabled={demoState === 'loading' || demoState === 'success'}
        >
          {demoState === 'loading' ? 'Sending…' : 'Send demo video to TikTok Inbox'}
        </button>

        {demoState === 'loading' && (
          <p className="tt-exchange-loading demo-loading">
            Uploading video to TikTok inbox…
          </p>
        )}

        {demoState === 'success' && (
          <>
            <div className="demo-success">
              Demo mode: video sent to TikTok inbox successfully.
            </div>
            <button
              type="button"
              className="demo-reset"
              onClick={() => setDemoState('idle')}
            >
              Reset demo
            </button>
          </>
        )}

        <p className="demo-note">
          This review demo shows the intended Content Posting API user flow. In production, the upload
          is handled through TikTok's official API and may process asynchronously.
        </p>
      </section>

      <section className="card">
        <h2>What CreatorFlow Studio does</h2>
        <p>
          CreatorFlow Studio is built for the account owner's own content workflow. It
          lets you review and send your own creator-owned videos to TikTok through
          TikTok's official Content Posting API. It does not perform scraping, follower
          automation, mass liking, mass commenting, artificial engagement, or
          unauthorized posting.
        </p>
      </section>

      <section className="card tt-section">
        <h2>TikTok Account Connection</h2>

        <div className="tt-meta-row">
          <span className="tt-label">Permissions</span>
          <span className="tt-value">Basic account info · video upload</span>
        </div>

        <button
          type="button"
          className="tt-btn"
          onClick={handleConnect}
          disabled={missingConfig}
        >
          Connect TikTok Account
        </button>

        <p className="tt-warning">
          <strong>Privacy note:</strong> CreatorFlow Studio connects securely to TikTok.
          Your account credentials are never stored in your browser.
        </p>

        {callbackResult && (
          <div className="tt-callback">
            <hr className="tt-divider" />
            <h3>OAuth Callback Result</h3>

            <div className="tt-status-row">
              <span className="tt-label">Authorization code</span>
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
                <span className="tt-badge tt-fail">does not match</span>
              )}
            </div>

            {callbackResult.error && (
              <>
                <div className="tt-status-row">
                  <span className="tt-label">Error</span>
                  <span className="tt-badge tt-fail">{callbackResult.error}</span>
                </div>
                {callbackResult.errorDescription && (
                  <div className="tt-status-row">
                    <span className="tt-label">Description</span>
                    <span className="tt-code">{callbackResult.errorDescription}</span>
                  </div>
                )}
              </>
            )}

            <p className="tt-warning tt-warning--callback">
              <strong>Connecting securely:</strong> Your account is being authorized
              via TikTok's official OAuth flow.
            </p>
          </div>
        )}

        {exchangeStatus !== 'idle' && (
          <div className="tt-exchange">
            <hr className="tt-divider" />
            <h3>Token Exchange Result</h3>

            {exchangeStatus === 'skipped' && (
              <p className="tt-warning">
                State mismatch — token exchange skipped for security.
              </p>
            )}

            {exchangeStatus === 'loading' && (
              <p className="tt-exchange-loading">Exchanging token with backend…</p>
            )}

            {exchangeStatus === 'done' && tokenResult && (
              <>
                <div className="tt-status-row">
                  <span className="tt-label">Status</span>
                  <span className={`tt-badge ${tokenResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                    {tokenResult.ok ? 'ok' : 'error'}
                  </span>
                </div>

                {tokenResult.ok ? (
                  <>
                    <div className="tt-status-row">
                      <span className="tt-label">Token received</span>
                      <span className={`tt-badge ${tokenResult.tokenReceived ? 'tt-ok' : 'tt-fail'}`}>
                        {tokenResult.tokenReceived ? 'yes' : 'no'}
                      </span>
                    </div>

                    <div className="tt-status-row">
                      <span className="tt-label">Open ID received</span>
                      <span className={`tt-badge ${tokenResult.openIdReceived ? 'tt-ok' : 'tt-fail'}`}>
                        {tokenResult.openIdReceived ? 'yes' : 'no'}
                      </span>
                    </div>

                    {tokenResult.scope && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Scope</span>
                        <span className="tt-value">{tokenResult.scope}</span>
                      </div>
                    )}

                    {tokenResult.tokenType && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Token type</span>
                        <span className="tt-value">{tokenResult.tokenType}</span>
                      </div>
                    )}

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
                      <div className="tt-status-row">
                        <span className="tt-label">Error</span>
                        <span className="tt-badge tt-fail">{tokenResult.error}</span>
                      </div>
                    )}

                    {tokenResult.error_description && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Description</span>
                        <span className="tt-value">{tokenResult.error_description}</span>
                      </div>
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
        )}
      </section>

      <section className="card tt-section tt-publish-section">
        <h2>Send Video to TikTok</h2>

        <div className="tt-meta-row">
          <span className="tt-label">Test video</span>
          <a
            className="tt-value"
            href={TEST_VIDEO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {TEST_VIDEO_URL}
          </a>
        </div>

        <div className="tt-field-row">
          <label className="tt-label" htmlFor="publish-title">Upload title</label>
          <input
            id="publish-title"
            className="tt-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="tt-meta-row">
          <span className="tt-label">Privacy level</span>
          <span className="tt-value">N/A — set by creator in TikTok inbox</span>
        </div>

        <label className="tt-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I confirm that I want to initiate an inbox upload to my connected TikTok account.
        </label>

        <div>
          <button
            type="button"
            className="tt-btn"
            onClick={handlePublish}
            disabled={!consent || publishState === 'loading'}
          >
            {publishState === 'loading' ? 'Uploading…' : 'Send to My TikTok Inbox'}
          </button>
        </div>

        {publishState !== 'idle' && (
          <div className="tt-exchange">
            <hr className="tt-divider" />
            <h3>Inbox Upload Result</h3>

            {publishState === 'loading' && (
              <p className="tt-exchange-loading">Uploading video…</p>
            )}

            {publishState === 'done' && publishResult && (
              <>
                <div className="tt-status-row">
                  <span className="tt-label">ok</span>
                  <span className={`tt-badge ${publishResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                    {String(publishResult.ok)}
                  </span>
                </div>

                {publishResult.error && (
                  <div className="tt-meta-row">
                    <span className="tt-label">error</span>
                    <span className="tt-code">{publishResult.error}</span>
                  </div>
                )}

                {publishResult.publishId != null && (
                  <div className="tt-meta-row">
                    <span className="tt-label">publishId</span>
                    <span className="tt-code">{publishResult.publishId}</span>
                  </div>
                )}

                {publishResult.binaryUploadOk != null && (
                  <div className="tt-status-row">
                    <span className="tt-label">binaryUploadOk</span>
                    <span className={`tt-badge ${publishResult.binaryUploadOk ? 'tt-ok' : 'tt-fail'}`}>
                      {String(publishResult.binaryUploadOk)}
                    </span>
                  </div>
                )}

                {publishResult.binaryUploadStatus != null && (
                  <div className="tt-meta-row">
                    <span className="tt-label">binaryUploadStatus</span>
                    <span className="tt-value">{publishResult.binaryUploadStatus}</span>
                  </div>
                )}

                {publishResult.statusCheckOk != null && (
                  <div className="tt-status-row">
                    <span className="tt-label">statusCheckOk</span>
                    <span className={`tt-badge ${publishResult.statusCheckOk ? 'tt-ok' : 'tt-fail'}`}>
                      {String(publishResult.statusCheckOk)}
                    </span>
                  </div>
                )}

                {publishResult.publishStatus != null && (
                  <div className="tt-meta-row">
                    <span className="tt-label">publishStatus</span>
                    <span className="tt-value">{publishResult.publishStatus}</span>
                  </div>
                )}

                {publishResult.uploadedBytes != null && (
                  <div className="tt-meta-row">
                    <span className="tt-label">uploadedBytes</span>
                    <span className="tt-value">{publishResult.uploadedBytes.toLocaleString()}</span>
                  </div>
                )}
              </>
            )}

            {sheetSyncStatus !== 'idle' && (
              <p className={`tt-sheet-sync${sheetSyncStatus === 'saved' ? ' tt-sheet-sync--ok' : sheetSyncStatus === 'failed' ? ' tt-sheet-sync--fail' : ''}`}>
                {sheetSyncStatus === 'loading' && 'Google Sheet sync: syncing…'}
                {sheetSyncStatus === 'saved' && 'Google Sheet sync: saved'}
                {sheetSyncStatus === 'failed' && 'Google Sheet sync: skipped/failed'}
              </p>
            )}

            {publishState === 'done' && publishResult?.publishId != null && (
              <>
                <hr className="tt-divider" />
                <h3>TikTok Status Refresh</h3>

                <button
                  type="button"
                  className="tt-btn-secondary"
                  onClick={handleRefreshStatus}
                  disabled={statusRefreshState === 'loading'}
                >
                  {statusRefreshState === 'loading' ? 'Checking…' : 'Refresh TikTok Status'}
                </button>

                {statusRefreshState === 'done' && statusRefreshResult && (
                  <div className="tt-refresh-result">
                    <div className="tt-status-row">
                      <span className="tt-label">ok</span>
                      <span className={`tt-badge ${statusRefreshResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                        {String(statusRefreshResult.ok)}
                      </span>
                    </div>

                    {statusRefreshResult.publishStatus != null && (
                      <div className="tt-status-row">
                        <span className="tt-label">publishStatus</span>
                        <span className={`tt-badge ${
                          statusRefreshResult.publishStatus === 'PUBLISH_COMPLETE' ||
                          statusRefreshResult.publishStatus === 'SEND_TO_USER_INBOX'
                            ? 'tt-ok'
                            : statusRefreshResult.publishStatus === 'FAILED'
                            ? 'tt-fail'
                            : 'tt-warn'
                        }`}>
                          {statusRefreshResult.publishStatus}
                        </span>
                      </div>
                    )}

                    {statusRefreshResult.failReason != null && (
                      <div className="tt-meta-row">
                        <span className="tt-label">failReason</span>
                        <span className="tt-code">{statusRefreshResult.failReason}</span>
                      </div>
                    )}

                    {statusRefreshResult.uploadedBytes != null && (
                      <div className="tt-meta-row">
                        <span className="tt-label">uploadedBytes</span>
                        <span className="tt-value">{statusRefreshResult.uploadedBytes.toLocaleString()}</span>
                      </div>
                    )}

                    {statusRefreshResult.tikTokErrorCode && (
                      <div className="tt-meta-row">
                        <span className="tt-label">tikTokErrorCode</span>
                        <span className="tt-code">{statusRefreshResult.tikTokErrorCode}</span>
                      </div>
                    )}

                    {statusRefreshResult.tikTokErrorMessage && (
                      <div className="tt-meta-row">
                        <span className="tt-label">tikTokErrorMessage</span>
                        <span className="tt-code">{statusRefreshResult.tikTokErrorMessage}</span>
                      </div>
                    )}

                    {statusRefreshResult.error && (
                      <div className="tt-meta-row">
                        <span className="tt-label">error</span>
                        <span className="tt-code">{statusRefreshResult.error}</span>
                      </div>
                    )}
                  </div>
                )}

                {statusRefreshSheetSync !== 'idle' && (
                  <p className={`tt-sheet-sync${statusRefreshSheetSync === 'saved' ? ' tt-sheet-sync--ok' : statusRefreshSheetSync === 'failed' ? ' tt-sheet-sync--fail' : ''}`}>
                    {statusRefreshSheetSync === 'loading' && 'Google Sheet sync: syncing…'}
                    {statusRefreshSheetSync === 'saved' && 'Google Sheet sync: saved'}
                    {statusRefreshSheetSync === 'failed' && 'Google Sheet sync: skipped/failed'}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
