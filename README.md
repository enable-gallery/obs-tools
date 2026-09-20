# obs-tools

A monorepo of tools for running an OBS-based livestream, built as an npm
workspace: shared packages under [packages/](packages/) plus [host/](host/),
the process that runs everything.

## Host

[host/](host/) is a single process that holds one shared OBS connection,
one shared Twitch connection (one OAuth session, one EventSub WebSocket),
and an optional Discord bot connection, and loads feature modules against
those shared connections instead of each feature managing its own. Which
modules run is controlled by `host/config.json`'s `modules` block.

Modules today:

- **camera-switcher** ([host/src/modules/cameraSwitcher/](host/src/modules/cameraSwitcher/))
  — lets viewers switch OBS scenes/cameras by redeeming Twitch Channel
  Point rewards (one reward per OBS scene, kept in sync automatically).
  Registers its reward-redemption handling with the shared chat-controller
  rather than talking to Twitch's EventSub/redemption APIs directly.
- **discord-notify** ([host/src/modules/discordNotify.ts](host/src/modules/discordNotify.ts))
  — posts a going-live announcement to a Discord channel when the
  configured Twitch channel starts streaming.
- **stream-status-logger** ([host/src/modules/streamStatusLogger.ts](host/src/modules/streamStatusLogger.ts))
  — logs stream online/offline to the console and session log; a minimal
  reference module.

[host/src/chatController.ts](host/src/chatController.ts) is shared
infrastructure (not a module itself): it owns "a command was invoked" —
whether from a typed Twitch chat message (`!command`) or a channel-points
redemption — and routes it to whichever module registered a handler, so
modules never need to touch EventSub or the redemption-status API
themselves. It also owns a pause flag (toggled from the controller page)
that auto-refunds channel-points redemptions without running their
handler, without affecting typed chat commands.

### Web pages

The host serves two pages off one HTTP+WebSocket server
([host/src/setupServer.ts](host/src/setupServer.ts)), both live-updating:

- **`/`** — the controller: connection status, current OBS scene, a button
  grid to switch scenes manually (bypassing the Twitch reward economy), a
  pause/resume-redemptions toggle, a live feed of every redemption, and a
  "send test" action for any running module that implements one (e.g.
  discord-notify).
- **`/setup`** — OBS/Twitch/Discord connection credentials (saved back to
  `host/.env`, connects live, no restart needed), plus a few
  module-specific settings that are awkward to hand-edit in
  `host/config.json`: camera-switcher's reward settings ("Editing
  rewards" and "Random transition reward" — cost, cooldown, title/prompt
  templates, which OBS scenes are included) and discord-notify's target
  channel and message template.

## Shared packages

Common OBS/Twitch functionality lives in [packages/](packages/) as npm
workspace packages (`@obs-tools/<name>`), so modules don't have to
reimplement OBS connection handling, Twitch auth, or EventSub/reward
management from scratch. See [packages/README.md](packages/README.md) for
what each one does and how to add a new one.

## Getting started

```
npm install
```

Then, from `host/`:

```
npm run dev
```

This runs the real host against your real OBS/Twitch/Discord connections
(not a fake demo mode). It starts fine with nothing configured — open the
setup page at `http://localhost:4600/setup` to enter OBS/Twitch/Discord
credentials at runtime (saved back to `host/.env`, connects live, no
restart needed); or copy `host/.env.example` to `host/.env` and fill it in
by hand ahead of time. Either way, which *modules* run is controlled
separately by `host/config.json`. The controller page at
`http://localhost:4600/` is where you actually run the stream day to day.

## Repo layout

```
obs-tools/
├── packages/  # shared workspace packages (@obs-tools/*)
├── host/      # the process that runs everything — shared connections + modules
└── sessions/  # per-run session logs, shared across modules, gitignored
```
