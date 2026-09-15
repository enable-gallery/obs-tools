# Insta360 Link camera presets (removed from core app)

Removed from the active `obs-chat-controller` app on 2026-09-15 — this was a
personal/bespoke reward type (triggering Insta360 Link camera presets via
simulated hotkeys), not something every user of the tool needs. Kept here so
it can become a proper plugin later, once there's a plugin system for
personal/stream-specific extras.

Original behavior: lets viewers redeem channel points to move an Insta360
Link webcam to a saved pan/tilt/zoom preset, alongside the OBS scene
switches. Worked by simulating the global hotkey combo bound to that preset
in the official Insta360 Link Controller desktop app (that app had to be
running, with a hotkey assigned per preset).

## Files kept as-is in this folder

- `insta360ControllerConfig.ts.bak` — reads hotkey bindings out of Insta360
  Link Controller's own `startup.ini` (`%LOCALAPPDATA%\Insta360\Insta360 Link
  Controller\startup.ini`), used by the Setup page's "sync hotkeys" button.
- `hotkeySender.ts.bak` — generic OS-level hotkey combo parser/sender
  (`keybd_event` via a spawned PowerShell script). Only consumer was the
  insta360 feature, but nothing about it is insta360-specific — the next
  camera-preset-style plugin can likely reuse it verbatim.

Both still import each other exactly as they did in `src/` — rename back to
`.ts` and drop into `src/` (or a plugin package) to resurrect.

## Surgical pieces removed from shared files (reproduced here, not live code)

### `src/config.ts`
`RewardConfig.kind` union was `"scene" | "transition" | "insta360Preset"`
(now just `"scene" | "transition"`). The `hotkey?: string` field on
`RewardConfig` was insta360-only.

### `src/configStore.ts`
```ts
export interface Insta360Preset {
  name: string;
  hotkey: string;
}

export interface Insta360RewardSettings {
  enabled: boolean;
  cost: number;
  globalCooldownSeconds: number;
  backgroundColor: string;
  titleTemplate: string;
  promptTemplate: string;
  presets: Insta360Preset[];
}

export const DEFAULT_INSTA360_SETTINGS: Insta360RewardSettings = {
  enabled: false,
  cost: 200,
  globalCooldownSeconds: 30,
  backgroundColor: "#1E90FF",
  titleTemplate: "Camera preset: {preset}",
  promptTemplate: "Move the Insta360 Link camera to the {preset} preset",
  presets: [],
};
```
`RewardsFile` had an `insta360: Insta360RewardSettings` field, merged in
`readRewardsFile()` as `insta360: { ...DEFAULT_INSTA360_SETTINGS, ...parsed.insta360 }`.

### `src/autoRewards.ts`
```ts
export function deriveInsta360PresetRewards(settings: Insta360RewardSettings): RewardConfig[] {
  if (!settings.enabled) return [];

  return settings.presets
    .filter((preset) => preset.name && preset.hotkey)
    .map((preset) => ({
      title: settings.titleTemplate.replace("{preset}", preset.name),
      prompt: settings.promptTemplate.replace("{preset}", preset.name),
      cost: settings.cost,
      kind: "insta360Preset" as const,
      hotkey: preset.hotkey,
      globalCooldownSeconds: settings.globalCooldownSeconds,
      backgroundColor: settings.backgroundColor,
    }));
}
```

### `src/index.ts`
- Imported `deriveInsta360PresetRewards`, `sendHotkey`, `readConfiguredHotkeys`.
- `computeEffectiveRewards()` included `deriveInsta360PresetRewards(rewardsFile.insta360)` in the merged array.
- Three dashboard callbacks: `onSaveInsta360Settings` (persists settings + resyncs), `onTriggerInsta360Preset` (calls `sendHotkey(hotkey)`), `onRequestInsta360Hotkeys` (calls `dashboard.sendInsta360Hotkeys(readConfiguredHotkeys())`).
- In the EventSub redemption handler, a branch between the `"scene"` case and the transition fallthrough:
```ts
if (reward.kind === "insta360Preset") {
  if (paused) {
    await cancelRedemption(id, event, "(Insta360)", "ignored (redemptions paused)");
    return;
  }
  try {
    await sendHotkey(reward.hotkey!);
    await fulfillRedemption(id, event, "(Insta360)", "via Insta360 Link preset hotkey");
  } catch (err) {
    console.error(`[redemption] failed to trigger Insta360 preset "${reward.title}":`, err);
    await cancelRedemption(id, event, "(Insta360)", "hotkey send failed");
  }
  return;
}
```

### `src/dashboardServer.ts`
- Imported `isValidHotkeyCombo` (from `hotkeySender.js`) and `Insta360HotkeyScanResult` (from `insta360ControllerConfig.js`).
- `DashboardCallbacks` had `onSaveInsta360Settings`, `onTriggerInsta360Preset`, `onRequestInsta360Hotkeys`.
- `isValidInsta360Settings(value)` validator (parallel to `isValidAutoSettings`/`isValidTransitionSettings`), checked `presets[].hotkey` via `isValidHotkeyCombo`.
- Three WS message branches: `saveInsta360Settings`, `triggerInsta360Preset`, `requestInsta360Hotkeys`.
- `sendInsta360Hotkeys(result: Insta360HotkeyScanResult)` method: `this.broadcast({ type: "insta360Hotkeys", ...result })`.

### `src/devDashboardDemo.ts`
Mirrored `index.ts`'s wiring with fake data — `onTriggerInsta360Preset` just logged, `onRequestInsta360Hotkeys` replied with two hardcoded fake hotkeys.

### `public/dashboard.html`
In `renderCameras()`, a branch alongside the `"scene"` case:
```js
} else if (reward.kind === "insta360Preset") {
  const btn = document.createElement("button");
  btn.innerHTML = `${reward.title}<span class="scene">${reward.hotkey}</span>`;
  btn.addEventListener("click", () => {
    send({ type: "triggerInsta360Preset", hotkey: reward.hotkey });
  });
  cameraGrid.appendChild(btn);
}
```

### `public/setup.html`
A full "Insta360 Link presets" panel (enabled/cost/cooldown/color/title/prompt
fields, a dynamic preset list with add/remove rows, "Sync hotkeys from
Insta360 Link Controller" button, Save button) plus its JS: DOM lookups,
`addPresetRow`/`renderPresetList`/`collectPresets`/`collectInsta360Settings`/
`fillInsta360Form`/`mergeDiscoveredHotkeys`, a call to `fillInsta360Form` from
`applyRewardsConfig()`, an `insta360Hotkeys` WS message branch, and the three
button event listeners. See git history (commit removing this feature) for
the exact markup/script if reconstructing verbatim is useful.

### `config.json`
```json
"insta360": {
  "enabled": true,
  "cost": 200,
  "globalCooldownSeconds": 30,
  "backgroundColor": "#1e90ff",
  "titleTemplate": "Camera preset: {preset}",
  "promptTemplate": "Move the Insta360 Link camera to the {preset} preset",
  "presets": []
}
```

### `README.md`
Had a full "## Insta360 Link camera presets" section — see git history for
the exact text.
