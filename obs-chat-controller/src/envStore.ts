import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_PATH = ".env";

export function updateEnvValues(values: Record<string, string>): void {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8").split(/\r?\n/) : [];
  const seen = new Set<string>();

  const updatedLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && Object.prototype.hasOwnProperty.call(values, match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${values[match[1]]}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      updatedLines.push(`${key}=${value}`);
    }
  }

  writeFileSync(ENV_PATH, updatedLines.join("\n").replace(/\n+$/, "\n"));
}
