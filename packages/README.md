# packages

Shared code used by `host` and its modules. These are plain npm workspace
packages — private, not published — linked via the root `package.json`'s
`workspaces` field and referenced as `"@obs-tools/<name>": "*"` from
`host/package.json`.

If a new module needs to talk to OBS or Twitch, start here instead of
reimplementing it in the module itself.

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
- `EventSubClient` — the original single-topic (redemptions-only) EventSub
  WebSocket client. Superseded by `@obs-tools/twitch-eventsub` for new
  code; kept here only until nothing references it.

## `@obs-tools/twitch-eventsub`

`TwitchEventSubClient` — generic, multi-topic Twitch EventSub-over-WebSocket
client: a `subscribe({type, version, condition}, handler)` registry instead
of one hardcoded subscription type, so multiple independent consumers (chat
messages, channel-points redemptions, stream online/offline, …) share one
WebSocket connection. Handles session welcome/reconnect (subscriptions
carry over automatically across a Twitch-initiated reconnect) and
auto-reconnects on drop.

## `@obs-tools/obs-client`

`ObsController` — wraps `obs-websocket-js` for OBS's WebSocket v5 API:
connect/reconnect, current scene tracking, scene list + transition list,
switching scenes (with or without a specific transition), and
connection/scene-change/scene-list-change callbacks. Note that OBS doesn't
emit a change event when you switch to a different Scene Collection
entirely — the automatic `onSceneListChange`-triggered resync (see
`camera-switcher`) won't catch that case; there's no manual "refresh"
path wired up for it yet since `host` doesn't have a dashboard.

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
