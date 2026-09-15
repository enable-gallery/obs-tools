# Twitch auth setup

This walks through connecting obs-chat-controller to your Twitch channel, from creating a Twitch application through the first-run authorization. Do this once per install — after that, the app refreshes its own token automatically.

## 1. Create a Twitch application

1. Go to [dev.twitch.tv/console](https://dev.twitch.tv/console) and log in **as the broadcaster account** (the channel the rewards will belong to).
2. Open the **Applications** tab and click **Register Your Application**.
3. Fill in the form:
   - **Name** — anything unique, e.g. `<yourchannel> OBS Camera Switcher`. Twitch requires this to be globally unique across all apps, so add your channel name if a generic name is taken.
   - **OAuth Redirect URLs** — must exactly match `TWITCH_REDIRECT_URI` (default `http://localhost:3000/callback`). Exact match includes the scheme, port, and trailing slash — `http://localhost:3000/callback` and `http://localhost:3000/callback/` are different URLs as far as Twitch is concerned.
   - **Category** — `Application Integration` is a safe default.
   - **Client Type** — `Confidential`.
4. Click **Create**.

## 2. Get your Client ID and secret

On the app's Manage page:
- Copy the **Client ID** — visible immediately.
- Click **New Secret** to generate a **Client Secret**. Twitch only shows it once, so copy it now. If you lose it, you'll need to generate a new one (this invalidates the old secret immediately).

## 3. Enter your credentials into the app

Either edit `.env` directly, or start the app and use the dashboard's **Setup** page (`http://localhost:4510/setup`) — both end up writing the same values to `.env`.

You need four values:
- `TWITCH_CLIENT_ID` — from step 2
- `TWITCH_CLIENT_SECRET` — from step 2
- `TWITCH_REDIRECT_URI` — must match what you registered in step 1 exactly
- `TWITCH_CHANNEL` — your channel's **login name** (the lowercase name in your channel URL, e.g. `yourchannel` from `twitch.tv/yourchannel`), not your display name if the two differ.

## 4. Authorize

1. Start the app (`npm start` or `npm run dev`).
2. If this is the first run (or `.twitch-tokens.json` doesn't exist yet), the console prints an authorization URL, and the Setup page also shows a **Connect to Twitch** button once credentials are saved.
3. Open that URL **in a browser logged into Twitch as the broadcaster account** — if you're also logged into a different Twitch account (e.g. a mod or bot account) in that browser, log out of it first, or use a private/incognito window.
4. Twitch shows a consent screen listing the requested scopes — `channel:read:redemptions` and `channel:manage:redemptions`. Approve it.
5. Twitch redirects back to your `TWITCH_REDIRECT_URI`. The app runs a small local HTTP server on that port just long enough to catch this one redirect and extract the authorization code — you'll see "Authorization complete, you can close this tab."
6. The app exchanges that code for an access + refresh token pair and saves them to `.twitch-tokens.json` in the project directory (gitignored). From then on, the app reuses and auto-refreshes this token — you won't see the authorization prompt again unless that file is deleted or Twitch revokes access.

## Troubleshooting

- **`redirect_mismatch` error from Twitch** — the URI Twitch redirected to doesn't exactly match one registered on the app. Compare `TWITCH_REDIRECT_URI` character-for-character against the OAuth Redirect URLs list on [dev.twitch.tv/console](https://dev.twitch.tv/console) (scheme, host, port, trailing slash all matter).
- **Nothing happens / connection refused after clicking the authorization URL** — something else is already using the port in `TWITCH_REDIRECT_URI` (default `3000`). Free that port, or change the port in both `.env` and the app's registered redirect URL, then restart.
- **Authorized the wrong Twitch account** — the rewards will be created on whichever account approved the consent screen. Delete `.twitch-tokens.json`, log the correct account into your browser, and restart the app to re-authorize.
- **Want to fully reset the connection** — delete `.twitch-tokens.json` and restart; the app will treat it as a first run and prompt for authorization again.
- **Rotated the Client Secret** — update `TWITCH_CLIENT_SECRET` in `.env` (or the Setup page) immediately; the old secret stops working the moment you generate a new one.

## Keeping credentials safe

`TWITCH_CLIENT_SECRET` and the contents of `.twitch-tokens.json` both grant control over your channel's rewards — treat them like passwords. Both `.env` and `.twitch-tokens.json` are gitignored by default; don't paste their contents into issues, chat logs, or screenshots.
