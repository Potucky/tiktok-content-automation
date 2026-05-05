# TikTok Sandbox Technical Plan

Goal:
Check whether TikTok API access is technically possible before investing more time.

## Step 1 — Switch to Sandbox

In TikTok Developer Portal, switch from Production to Sandbox.

## Step 2 — Add Product

Add:
Content Posting API

Do not add unnecessary products.

Avoid:
- Login Kit unless required by Content Posting API OAuth flow
- Share Kit
- Display API
- Research API
- Commercial Content API

## Step 3 — Add Scopes

Try to add:

user.info.basic
video.upload
video.publish

If video.publish is not available, start with:

user.info.basic
video.upload

## Step 4 — Configure Web / Redirect URI

Expected redirect URI for future local testing:

http://localhost:5173/auth/tiktok/callback

Expected redirect URI for GitHub Pages / production-like testing:

https://potucky.github.io/tiktok-content-automation/auth/tiktok/callback

Important:
Do not expose client_secret in frontend code.
Client secret must stay server-side only.

## Step 5 — Technical proof

Minimum technical check:

1. OAuth authorization URL opens.
2. User authorizes app.
3. App receives authorization code.
4. Server exchanges code for access token.
5. App calls creator/account info endpoint.
6. App checks upload/publish initialization availability.
7. App confirms sandbox restrictions and posting limits.

## Step 6 — Decision point

If Sandbox gives access to Content Posting API and scopes:
Continue building CreatorFlow Studio posting flow.

If Sandbox blocks Content Posting API or scopes:
Stop and reassess before investing more time.
