# obs-chat-controller

Lets viewers switch OBS scenes/cameras by redeeming Twitch Channel Point rewards.

## How it works

- Connects to OBS via its built-in [obs-websocket](https://github.com/obsproject/obs-websocket) v5 server, using [obs-websocket-js](https://github.com/obsproject/obs-websocket-js).
- Uses the Twitch Helix API to create/update Channel Point custom rewards (title, cost, cooldown) from `config.json`, so you manage cameras in one place instead of the Twitch dashboard.
- Subscribes to Twitch [EventSub](https://dev.twitch.tv/docs/eventsub/) over WebSocket for `channel.channel_points_custom_reward_redemption.add`.
- When a mapped reward is redeemed, it switches the OBS program scene and marks the redemption `FULFILLED`. If the scene doesn't exist in OBS, the redemption is marked `CANCELED` (Twitch automatically refunds the viewer's points). A separate, pricier reward switches to a random camera using a random OBS transition instead of a fixed one.
- Serves a local web dashboard (see below) for manual control and live status.

## Setup

### 1. Enable obs-websocket in OBS

`Tools > WebSocket Server Settings` (built into OBS 28+). Enable the server, note the port (default `4455`) and password. You can enter these either in `.env` (below) or later from the dashboard's Setup page — either way they're saved to `.env` for next run.

### 2. Register/confirm your Twitch application

At https://dev.twitch.tv/console, your app needs a redirect URI registered that matches `TWITCH_REDIRECT_URI` below (default `http://localhost:3000/callback`).

### 3. Configure environment

All of these can also be entered later from the dashboard's Setup page instead of editing `.env` by hand — the app starts up fine with none of them set and just waits for you to fill them in. To pre-fill them, copy `.env.example` to `.env` and fill in your values:

```
copy .env.example .env
```

```
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_REDIRECT_URI=http://localhost:3000/callback
TWITCH_CHANNEL=your_channel_name
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
OBS_WEBSOCKET_PASSWORD=your_obs_websocket_password
DASHBOARD_PORT=4510
```

Whatever you save from the Setup page is written back to `.env` so it persists across restarts.

### 4. Configure camera rewards in `config.json`

One reward is generated per OBS scene automatically — no per-camera list to maintain. Add or remove a scene in OBS and the rewards on Twitch update to match. Configure the shared defaults and which scenes to exclude (e.g. overlay/BRB scenes that aren't real camera angles), or do this from the Setup page instead of editing the file:

```json
{
  "auto": {
    "cost": 150,
    "globalCooldownSeconds": 30,
    "backgroundColor": "#9147FF",
    "titleTemplate": "Switch to {scene}",
    "promptTemplate": "Switch the stream camera to {scene}",
    "excludedScenes": ["Starting Soon", "BRB"]
  }
}
```

- `globalCooldownSeconds` maps to Twitch's native per-reward cooldown (applies to all viewers, not per-user) — this is Twitch's own rate limiting, so the app doesn't need to replicate cooldown logic itself.
- Rewards for scenes that no longer exist in OBS are automatically removed from Twitch, since the reward list always mirrors OBS exactly.
- The app only ever creates/updates/deletes rewards it created itself (`only_manageable_rewards=true`), so it won't touch rewards you made by hand in the Twitch dashboard.

There's also one extra, pricier reward — "Random Transition Cam Switch" — that isn't tied to a specific scene. Redeeming it switches to a random included camera using a randomly picked OBS scene transition (Cut, Fade, Stinger, etc. — whatever's configured in OBS's `Scene Transitions` dropdown). It only appears once at least 2 camera scenes are included, and is configured separately (or edited from the Setup page):

```json
{
  "transition": {
    "enabled": true,
    "cost": 500,
    "globalCooldownSeconds": 60,
    "backgroundColor": "#FF4500",
    "title": "Random Transition Cam Switch",
    "prompt": "Switch camera using a random OBS transition"
  }
}
```

### 5. Install and run

```
npm install
npm start
```

On first run, it prints an authorization URL — open it **while logged in as the broadcaster** and approve access. This grants a user token scoped to `channel:read:redemptions` and `channel:manage:redemptions`, stored locally in `.twitch-tokens.json` (gitignored) and refreshed automatically on subsequent runs.

## What happens on each run

1. Starts the dashboard and attempts to connect to OBS. If OBS isn't reachable yet, the app keeps running — connect it from the Setup page whenever OBS is up.
2. If Twitch credentials aren't configured yet, it waits for you to enter them on the Setup page. If a Twitch token is already saved, authenticates automatically (refreshing as needed). Otherwise it waits for you to click "Connect to Twitch" on the Setup page.
3. Once authenticated, looks up your broadcaster ID and reconciles rewards in `config.json` against what's already configured on Twitch (creates new ones, updates changed ones).
4. Opens an EventSub WebSocket connection and subscribes to redemption events.
5. On each qualifying redemption, switches the OBS scene and resolves the redemption as fulfilled or (on failure) canceled/refunded.

The app automatically reconnects both the OBS and EventSub WebSocket connections if either drops.

## Adding more cameras

Just add the scene in OBS — its reward is created (and appears in the Setup page's scene checklist) automatically, no restart needed.

## Dashboard

Open `http://localhost:4510` (or your configured `DASHBOARD_PORT`) while the app is running to get:

- Live status pills for the OBS and Twitch/EventSub connections, plus the current OBS scene.
- One button per configured camera reward, for switching scenes manually (bypasses Twitch entirely — no redemption or cost involved). The random transition reward isn't tied to a scene, so it has no manual button.
- A "Pause redemptions" toggle. While paused, incoming channel point redemptions are automatically refunded instead of switching the camera — useful if you want to take manual control for a bit without disabling the rewards on Twitch.
- A live feed of redemptions as they come in, mirroring the session log below.

The dashboard is plain HTTP + WebSocket on localhost, with no authentication — don't expose the port outside your own machine/network.

## Setup page

Open `http://localhost:4510/setup` (linked from the main dashboard) for one-time and ongoing configuration, without editing files by hand:

- **OBS connection** — enter the WebSocket URL/password and click "Save & connect". Saved values are written to `.env` so they persist across restarts; leave the password field blank to keep the currently saved password.
- **Twitch connection** — enter the app's Client ID/secret, channel name, and redirect URI (from `.env` or [dev.twitch.tv/console](https://dev.twitch.tv/console)) and click "Save"; leave the secret field blank to keep the currently saved one. Once saved, a "Connect to Twitch" button opens the OAuth authorization page in a new tab and reflects live authorized/connected status. Credentials only need to be entered once; the resulting token is reused and refreshed automatically afterward.
- **Camera rewards** — shared cost/cooldown/color/title settings, plus a checklist of every scene currently in OBS to include or exclude, with a live preview of the resulting rewards. Saving writes to `config.json` and, if Twitch is already connected, immediately resyncs the rewards with Twitch and pushes the updated camera buttons to the main dashboard. Adding or removing a scene in OBS while the app is running resyncs the rewards on its own, with no action needed here.
- **Random transition reward** — enable/disable it and set its own cost/cooldown/color/title/prompt, independent of the per-camera settings above. Saving resyncs it with Twitch the same way.

## Insta360 Link camera presets

If you're on an Insta360 Link webcam, you can also let viewers redeem channel points to move it to a saved pan/tilt/zoom preset, alongside the OBS scene switches above.

This works by simulating the global hotkey combo you've bound to that preset in the official **Insta360 Link Controller** desktop app — so that app needs to be running, with a hotkey assigned to each preset you want to expose (its settings screen lets you bind one per preset).

Configure it from the Setup page's **Insta360 Link presets** panel, or by editing `config.json`'s `insta360` key directly:

```json
{
  "insta360": {
    "enabled": true,
    "cost": 200,
    "globalCooldownSeconds": 30,
    "backgroundColor": "#1E90FF",
    "titleTemplate": "Camera preset: {preset}",
    "promptTemplate": "Move the Insta360 Link camera to the {preset} preset",
    "presets": [
      { "name": "Wide", "hotkey": "alt+1" },
      { "name": "Desk", "hotkey": "alt+2" }
    ]
  }
}
```

- One Twitch reward is created per preset (same reconciliation behavior as camera rewards — add/remove/rename a preset and Twitch updates to match).
- Hotkeys are written as `modifier+modifier+key`, e.g. `ctrl+alt+1` or `ctrl+shift+f5`. Supported modifiers: `ctrl`, `alt`, `shift`, `win`. Keys: any letter, digit, or `f1`-`f24`.
- Click **Sync hotkeys from Insta360 Link Controller** on the Setup page to auto-fill hotkey combos straight out of that app's own config (`%LOCALAPPDATA%\Insta360\Insta360 Link Controller\startup.ini`), instead of retyping them. It only recovers the hotkey combo — Insta360 doesn't expose preset names locally (they live on the camera's firmware), so give each synced entry a descriptive name before saving. **Verify each synced hotkey actually moves the camera before relying on it** — the only entries currently exposed in that config file are labeled `Device1`-`Device4`, and on at least one setup those turned out not to be the real preset-recall shortcut (the working one omitted the `Ctrl` modifier). Adjust the hotkey field by hand if what's synced doesn't work.
- Redeeming triggers the hotkey at the OS input level (not just to whichever window has focus), so it reaches the Insta360 Link Controller app's global hotkey listener even while OBS or the dashboard is focused.
- Manual trigger buttons for each preset also appear on the main dashboard, same as the camera buttons.

## Who redeemed this session

Every redemption (fulfilled or canceled/refunded) is appended to a per-run log at `sessions/session-<start-time>.jsonl`, one JSON object per line: `{ timestamp, userName, rewardTitle, sceneName, status }`.

When you stop the app (Ctrl+C), it prints a summary of that session to the console — each viewer who redeemed and how many times — and points you to the full log file. `sessions/` is gitignored since it's per-run local data.

## Development

```
npm run dev             # start with auto-restart on file changes
npm run dashboard:demo  # run the dashboard/setup UI against fake OBS/Twitch data, no real connections needed
npm run typecheck       # type-check without emitting
npm run build           # compile to JS via tsc
```
