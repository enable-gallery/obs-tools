# packages

Shared code used by every tool in this repo (`obs-chat-controller` today,
more later). These are plain npm workspace packages — private, not
published — linked via the root `package.json`'s `workspaces` field and
referenced as `"@obs-tools/<name>": "*"` from each tool's `package.json`.

If a new tool needs to talk to OBS or manage Twitch channel-point rewards,
start here instead of reimplementing it in the tool itself.

## `@obs-tools/twitch-auth`

OAuth Authorization Code flow against Twitch (per-user Twitch app, not a
shared/multi-tenant one), token refresh, and an authenticated Helix fetch
wrapper.

- `TwitchAuth` — handles the browser-based authorize step, persists tokens
  to a local JSON file (default `.twitch-tokens.json`), refreshes
  automatically. Construct with `{ clientId, clientSecret, redirectUri,
  scopes }`.
- `TwitchHelixClient` — thin authenticated `fetch` wrapper for
  `api.twitch.tv/helix/*`: attaches the client-id header and bearer token,
  throws on non-2xx responses.

## `@obs-tools/twitch-rewards`

Everything about managing Twitch channel-point rewards and reacting to
redemptions, built on `twitch-auth`.

- `TwitchRewardsClient` — reward CRUD (create/update/delete/list), broadcaster
  ID lookup, redemption status updates, and EventSub subscription creation.
  Takes a generic `TwitchRewardInput` (`title`, `cost`, `prompt?`,
  `globalCooldownSeconds?`, `backgroundColor?`) — any tool-specific reward
  type that has those fields works without adapting.
- `syncRewards(api, broadcasterId, rewards, pruneRemoved)` — reconciles a
  desired reward list against what's already on Twitch (creates new,
  updates changed, optionally deletes removed). Generic over the reward
  type, so it hands back a `Map<rewardId, YourRewardType>` for redemption
  lookups.
- `EventSubClient` — WebSocket client for Twitch EventSub, currently wired
  for `channel.channel_points_custom_reward_redemption.add`. Handles
  session welcome/reconnect and auto-reconnects on drop.

## `@obs-tools/obs-client`

`ObsController` — wraps `obs-websocket-js` for OBS's WebSocket v5 API:
connect/reconnect, current scene tracking, scene list + transition list,
switching scenes (with or without a specific transition), and
connection/scene-change/scene-list-change callbacks. Note that OBS doesn't
emit a change event when you switch to a different Scene Collection
entirely — callers need their own manual "refresh" path for that (see
`obs-chat-controller`'s Setup page for the pattern).

## `@obs-tools/session-log`

`SessionLog` — appends structured entries to a per-run JSONL file and
prints an end-of-session console summary grouped by `userName`. Entry
shape (`SessionLogEntry`) is intentionally generic (`timestamp`, `userName`,
`rewardTitle`, `detail`, `status`) so it isn't tied to OBS scenes
specifically — `detail` is whatever free-text description of the outcome
makes sense for that tool.

## Adding a new package

Match the existing shape: `package.json` with `"private": true`, `"type":
"module"`, `"main"`/`"types"` both pointing at `src/index.ts` (no build
step needed since tools run these via `tsx`), a `tsconfig.json` copied from
an existing package, and a barrel `src/index.ts` re-exporting the public
API. Run `npm install` from the repo root afterward so the workspace
symlink gets created.
