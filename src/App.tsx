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
  'https://potucky.github.io/tiktok-content-automation/test-videos/tiktok-test-upload.mp4';
const DEFAULT_TITLE = 'TikTok inbox upload test';
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
}

type ExchangeStatus = 'idle' | 'loading' | 'done' | 'skipped';
type PublishStatus = 'idle' | 'loading' | 'done';
type StatusRefreshState = 'idle' | 'loading' | 'done';
type SheetSyncStatus = 'idle' | 'loading' | 'saved' | 'failed';

function maskKey(key: string): string {
  if (key.length <= 6) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}${'*'.repeat(key.length - 6)}`;
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
    let result: PublishResult = { ok: false };
    try {
      const res = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

    let result: StatusRefreshResult = { ok: false };
    try {
      const res = await fetch(STATUS_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
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
    };
    logToGoogleSheet(asPublishResult, title, 'status_refresh')
      .then((synced) => setStatusRefreshSheetSync(synced ? 'saved' : 'failed'))
      .catch(() => setStatusRefreshSheetSync('failed'));
  }

  if (path.includes('/terms')) {
    return (
      <main className="page">
        <section className="card">
          <h1>Terms of Service</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Purpose</h2>
          <p>
            CreatorFlow Studio is a creator tool intended to help the account
            owner prepare, upload, and publish short-form video content to their own
            TikTok account using supported content posting APIs.
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
          <h1>Privacy Policy</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Overview</h2>
          <p>
            CreatorFlow Studio is a creator tool used to help the account owner
            prepare, upload, and publish short-form video content to their connected creator
            account using supported content posting APIs.
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
        <div className="badge">Creator API Tool</div>
        <h1>CreatorFlow Studio</h1>
        <p>
          A creator tool for preparing, uploading, and publishing short-form video
          content to the owner's connected creator account using the official TikTok Content
          Posting API.
        </p>

        <div className="links">
          <a href={`${import.meta.env.BASE_URL}terms/`}>Terms of Service</a>
          <a href={`${import.meta.env.BASE_URL}privacy/`}>Privacy Policy</a>
        </div>
      </section>

      <section className="card">
        <h2>What this app does</h2>
        <p>
          This app is designed for the account owner's own content workflow. It does
          not perform scraping, follower automation, mass liking, mass commenting,
          artificial engagement, or unauthorized posting.
        </p>
      </section>

      <section className="card tt-section">
        <h2>TikTok Sandbox Connection</h2>

        <div className="tt-meta-row">
          <span className="tt-label">Redirect URI</span>
          <span className="tt-value">
            {redirectUri ?? <span className="tt-missing">VITE_TIKTOK_REDIRECT_URI not set</span>}
          </span>
        </div>

        <div className="tt-meta-row">
          <span className="tt-label">Client key</span>
          <span className="tt-value">
            {clientKey
              ? maskKey(clientKey)
              : <span className="tt-missing">VITE_TIKTOK_CLIENT_KEY not set</span>}
          </span>
        </div>

        <div className="tt-meta-row">
          <span className="tt-label">Scope</span>
          <span className="tt-value">{SCOPE}</span>
        </div>

        <button
          type="button"
          className="tt-btn"
          onClick={handleConnect}
          disabled={missingConfig}
        >
          Connect TikTok Sandbox
        </button>

        <p className="tt-warning">
          <strong>Security notice:</strong> Token exchange must be handled by a secure backend.
          Do not expose Client Secret in the browser.
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
              {callbackResult.code && (
                <span className="tt-code">{callbackResult.code.slice(0, 12)}…</span>
              )}
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
              <strong>Next step (backend only):</strong> Token exchange must be handled by a
              secure backend. Do not expose Client Secret in the browser.
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
        <h2>TikTok Inbox Upload Test</h2>

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
            {publishState === 'loading' ? 'Uploading…' : 'Send Inbox Upload Test'}
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
