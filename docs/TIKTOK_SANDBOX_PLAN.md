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

Current approved scopes:

user.info.basic
video.upload

Note: video.publish was not added. Videos are sent to the creator's TikTok
inbox for review, not directly published. Direct Post is disabled.

## Step 4 — Configure Web / Redirect URI

Configured redirect URI (GitHub Pages):

<https://potucky.github.io/creatorflow-studio/>

For local testing, register a separate redirect URI:

<http://localhost:5173/>

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
