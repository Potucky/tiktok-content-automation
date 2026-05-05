import './App.css';

function App() {
  const path = window.location.pathname;

  if (path.includes('/terms')) {
    return (
      <main className="page">
        <section className="card">
          <h1>Terms of Service</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Purpose</h2>
          <p>
            TikTok Content Automation is a creator tool intended to help the account
            owner prepare, upload, and publish short-form video content to their own
            TikTok account using TikTok's official Content Posting API.
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
            TikTok Content Automation is a creator tool used to help the account owner
            prepare, upload, and publish short-form video content to their own TikTok
            account using TikTok's official Content Posting API.
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
        <h1>TikTok Content Automation</h1>
        <p>
          A creator tool for preparing, uploading, and publishing short-form video
          content to the owner's TikTok account using the official TikTok Content
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
    </main>
  );
}

export default App;
