# obs-tools

A monorepo of tools for running an OBS-based livestream, built as an npm
workspace: shared packages under [packages/](packages/) plus one or more
standalone apps that consume them.

## Tools

- [obs-chat-controller](obs-chat-controller/) — lets viewers switch OBS
  scenes/cameras by redeeming Twitch Channel Point rewards, with a local
  dashboard for manual control and live status. See its README for setup
  and usage.

## Shared packages

Common OBS/Twitch functionality lives in [packages/](packages/) as npm
workspace packages (`@obs-tools/<name>`), so new tools don't have to
reimplement OBS connection handling, Twitch auth, or reward management from
scratch. See [packages/README.md](packages/README.md) for what each one
does and how to add a new one.

## Getting started

```
npm install
```

Then, from a tool's own directory (e.g. `obs-chat-controller/`):

```
npm run dev
```

This runs the real app against your real OBS/Twitch connections (not a
fake demo mode) — see that tool's README for one-time setup like
configuring `.env` and connecting Twitch.

## Repo layout

```
obs-tools/
├── packages/            # shared workspace packages (@obs-tools/*)
├── obs-chat-controller/ # Twitch-redemption-driven OBS camera switcher
└── sessions/            # per-run session logs, shared across tools, gitignored
```
