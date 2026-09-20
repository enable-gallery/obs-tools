import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "..", "config.json");

export interface ConnectorFlags {
  obs: boolean;
  twitch: boolean;
  discord: boolean;
}

const DEFAULT_CONNECTOR_FLAGS: ConnectorFlags = { obs: false, twitch: false, discord: false };

interface HostConfigFile {
  modules: Record<string, { enabled: boolean }>;
  moduleConfig: Record<string, unknown>;
  connectors: ConnectorFlags;
}

function readHostConfigFile(): HostConfigFile {
  if (!existsSync(CONFIG_FILE)) {
    return { modules: {}, moduleConfig: {}, connectors: { ...DEFAULT_CONNECTOR_FLAGS } };
  }
  const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  return {
    modules: parsed.modules ?? {},
    moduleConfig: parsed.moduleConfig ?? {},
    connectors: { ...DEFAULT_CONNECTOR_FLAGS, ...parsed.connectors },
  };
}

function writeHostConfigFile(file: HostConfigFile): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + "\n");
}

/** Which module ids are enabled in host/config.json's "modules" block. */
export function loadEnabledModuleIds(): Set<string> {
  const file = readHostConfigFile();
  return new Set(Object.entries(file.modules)
    .filter(([, moduleConfig]) => moduleConfig.enabled)
    .map(([id]) => id));
}

/**
 * Per-connector "keep this connected even if no module currently needs it"
 * flags, toggled from the setup page's checkboxes — lets you test/establish
 * a live OBS/Twitch/Discord connection independent of module wiring.
 */
export function loadConnectorFlags(): ConnectorFlags {
  return readHostConfigFile().connectors;
}

export function saveConnectorFlags(flags: ConnectorFlags): void {
  const file = readHostConfigFile();
  file.connectors = flags;
  writeHostConfigFile(file);
}

export interface ModuleConfigStore<T> {
  read(): T;
  write(value: T): void;
}

/** A namespaced slice of host/config.json's "moduleConfig" block, scoped to one module id. */
export function createModuleConfigStore<T extends object>(moduleId: string, defaults: T): ModuleConfigStore<T> {
  return {
    read(): T {
      const file = readHostConfigFile();
      const stored = file.moduleConfig[moduleId];
      return { ...defaults, ...(typeof stored === "object" && stored !== null ? stored : {}) } as T;
    },
    write(value: T): void {
      const file = readHostConfigFile();
      file.moduleConfig[moduleId] = value;
      writeHostConfigFile(file);
    },
  };
}
