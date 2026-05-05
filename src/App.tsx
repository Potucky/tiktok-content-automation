import { useEffect, useState } from 'react';
import './App.css';

const TIKTOK_AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPE = 'user.info.basic,video.upload';
const SESSION_STATE_KEY = 'tiktok_oauth_state';
const EDGE_FUNCTION_URL =
  'https://sivnzgaphtgbepeinidz.supabase.co/functions/v1/tiktok-token-exchange';

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

type ExchangeStatus = 'idle' | 'loading' | 'done' | 'skipped';

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
  const [callbackResult, setCallbackResult] = useState<CallbackResult | null>(null);
  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus>('idle');
  const [tokenResult, setTokenResult] = useState<TokenExchangeResult | null>(null);

  useEffect(() => {
    setCallbackResult(parseCallback());
  }, []);

  useEffect(() => {
    if (!callbackResult?.code) return;

    const stateValid =
      callbackResult.returnedState !== null &&
      callbackResult.savedState !== null &&
      callbackResult.returnedState === callbackResult.savedState;

    if (!stateValid) {
      setExchangeStatus('skipped');
      return;
    }

    setExchangeStatus('loading');
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

          <a href="/">Back to home</a>
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

          <a href="/">Back to home</a>
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
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
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
    </main>
  );
}

export default App;
