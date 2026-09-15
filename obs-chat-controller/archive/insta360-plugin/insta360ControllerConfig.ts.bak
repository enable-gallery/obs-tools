import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isValidHotkeyCombo } from "./hotkeySender.js";

export interface DiscoveredHotkey {
  key: string;
  hotkey: string;
}

export interface Insta360HotkeyScanResult {
  found: boolean;
  hotkeys: DiscoveredHotkey[];
}

function normalizeCombo(raw: string): string {
  return raw
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join("+");
}

export function findStartupIniPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const iniPath = path.join(localAppData, "Insta360", "Insta360 Link Controller", "startup.ini");
  return existsSync(iniPath) ? iniPath : null;
}

/**
 * Reads hotkey bindings straight out of the Insta360 Link Controller app's own
 * config file. The app doesn't expose an API, and camera-side preset names
 * live in the camera's firmware (not readable locally) — so this only
 * recovers the hotkey combos, not friendly preset names.
 */
export function readConfiguredHotkeys(): Insta360HotkeyScanResult {
  const iniPath = findStartupIniPath();
  if (!iniPath) return { found: false, hotkeys: [] };

  const content = readFileSync(iniPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const hotkeys: DiscoveredHotkey[] = [];
  let inHotkeySection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inHotkeySection = trimmed.toLowerCase() === "[hotkey]";
      continue;
    }
    if (!inHotkeySection || !trimmed || trimmed.startsWith(";")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const combo = normalizeCombo(trimmed.slice(eq + 1));
    if (key && combo && isValidHotkeyCombo(combo)) hotkeys.push({ key, hotkey: combo });
  }

  return { found: true, hotkeys };
}
