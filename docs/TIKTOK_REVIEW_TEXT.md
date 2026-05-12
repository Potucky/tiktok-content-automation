# TikTok App Review Text

Use this text in the App review section after Content Posting API and scopes are added.

## Explain how each product and scope works

CreatorFlow Studio uses the Content Posting API to help creators send original
short-form videos to their TikTok account for review and publishing through
TikTok's official inbox upload flow.

The `user.info.basic` scope is used to identify the authorized creator account
and display account information during the posting flow.

The `video.upload` scope is used to upload user-approved video content after
the creator reviews the preview, title, and consent notice. Videos are sent to
the creator's TikTok inbox for review and publishing — Direct Post is disabled.

**Note — video.publish scope:** The `video.publish` scope is not currently
requested. It is a potential future addition only if Direct Post is enabled.
Do not include `video.publish` in the review submission until that feature is
explicitly added and approved.

The app does not scrape content, automate engagement, add promotional
watermarks, or post without user consent. Users control the content, metadata,
and the final send action. The app displays post status after submission.

## Important

Do not submit for review until the app has a real posting flow and a demo video.

A fake demo video is risky. The demo video should show the real website/app
where the Content Posting API integration is implemented.
