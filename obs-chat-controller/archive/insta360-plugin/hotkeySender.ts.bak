import { spawn } from "node:child_process";

// Virtual-key codes: https://learn.microsoft.com/windows/win32/inputdev/virtual-key-codes
const MODIFIER_CODES: Record<string, number> = {
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  shift: 0x10,
  win: 0x5b,
  meta: 0x5b,
};

function resolveKeyCode(part: string): number {
  const key = part.trim().toLowerCase();
  if (key in MODIFIER_CODES) return MODIFIER_CODES[key];
  if (/^[0-9]$/.test(key)) return 0x30 + Number(key);
  if (/^[a-z]$/.test(key)) return 0x41 + (key.charCodeAt(0) - 97);

  const fKeyMatch = /^f([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (fKeyMatch) return 0x70 + (Number(fKeyMatch[1]) - 1);

  throw new Error(`Unsupported key "${part}" in hotkey combo`);
}

export function parseHotkey(combo: string): number[] {
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Empty hotkey combo");
  return parts.map(resolveKeyCode);
}

export function isValidHotkeyCombo(combo: string): boolean {
  try {
    parseHotkey(combo);
    return true;
  } catch {
    return false;
  }
}

/**
 * Simulates the key combo at the OS input level (via keybd_event), rather than
 * posting messages to a specific window. Global hotkeys — like the ones the
 * Insta360 Link Controller app registers for its camera presets — only fire on
 * real input events, so this works regardless of which window has focus.
 */
export function sendHotkey(combo: string): Promise<void> {
  const codes = parseHotkey(combo);

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ObsToolsKeySender {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$codes = @(${codes.join(",")})
foreach ($code in $codes) {
  [ObsToolsKeySender]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
}
for ($i = $codes.Length - 1; $i -ge 0; $i--) {
  [ObsToolsKeySender]::keybd_event([byte]$codes[$i], 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 15
}
`.trim();

  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });

    let stderr = "";
    ps.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hotkey send exited with code ${code}: ${stderr.trim()}`));
    });
  });
}
