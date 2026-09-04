import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { RedemptionLogEntry } from "./sessionLog.js";
import type { RewardConfig } from "./config.js";
import type { AutoRewardSettings, Insta360RewardSettings, RewardsFile, TransitionRewardSettings } from "./configStore.js";
import { isValidHotkeyCombo } from "./hotkeySender.js";
import type { Insta360HotkeyScanResult } from "./insta360ControllerConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardStatus {
  obsConnected: boolean;
  twitchConfigured: boolean;
  twitchAuthorized: boolean;
  twitchConnected: boolean;
  currentScene: string | null;
  paused: boolean;
}

export interface SaveObsConfigPayload {
  url: string;
  password: string;
}

export interface SaveTwitchConfigPayload {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  channel: string;
}

export interface TwitchConfigView {
  clientId: string;
  redirectUri: string;
  channel: string;
}

export interface DashboardCallbacks {
  onSwitchScene: (sceneName: string) => void;
  onSetPaused: (paused: boolean) => void;
  onConnectTwitch: () => void;
  onSaveAutoSettings: (settings: AutoRewardSettings) => void;
  onSaveTransitionSettings: (settings: TransitionRewardSettings) => void;
  onSaveInsta360Settings: (settings: Insta360RewardSettings) => void;
  onTriggerInsta360Preset: (hotkey: string) => void;
  onRequestInsta360Hotkeys: () => void;
  onSaveObsConfig: (payload: SaveObsConfigPayload) => void;
  onSaveTwitchConfig: (payload: SaveTwitchConfigPayload) => void;
}

export interface DashboardServerOptions {
  port: number;
  rewardsConfig: RewardsFile;
  effectiveRewards: RewardConfig[];
  obsScenes: string[];
  obsUrl: string;
  twitchConfig: TwitchConfigView;
  status: DashboardStatus;
  callbacks: DashboardCallbacks;
}

function isValidAutoSettings(value: any): value is AutoRewardSettings {
  return (
    value &&
    typeof value.cost === "number" &&
    value.cost > 0 &&
    typeof value.globalCooldownSeconds === "number" &&
    value.globalCooldownSeconds >= 0 &&
    typeof value.backgroundColor === "string" &&
    typeof value.titleTemplate === "string" &&
    typeof value.promptTemplate === "string" &&
    Array.isArray(value.excludedScenes) &&
    value.excludedScenes.every((s: unknown) => typeof s === "string")
  );
}

function isValidTransitionSettings(value: any): value is TransitionRewardSettings {
  return (
    value &&
    typeof value.enabled === "boolean" &&
    typeof value.cost === "number" &&
    value.cost > 0 &&
    typeof value.globalCooldownSeconds === "number" &&
    value.globalCooldownSeconds >= 0 &&
    typeof value.backgroundColor === "string" &&
    typeof value.title === "string" &&
    typeof value.prompt === "string"
  );
}

function isValidInsta360Settings(value: any): value is Insta360RewardSettings {
  return (
    value &&
    typeof value.enabled === "boolean" &&
    typeof value.cost === "number" &&
    value.cost > 0 &&
    typeof value.globalCooldownSeconds === "number" &&
    value.globalCooldownSeconds >= 0 &&
    typeof value.backgroundColor === "string" &&
    typeof value.titleTemplate === "string" &&
    typeof value.promptTemplate === "string" &&
    Array.isArray(value.presets) &&
    value.presets.every(
      (preset: unknown) =>
        preset &&
        typeof (preset as any).name === "string" &&
        (preset as any).name.length > 0 &&
        typeof (preset as any).hotkey === "string" &&
        isValidHotkeyCombo((preset as any).hotkey)
    )
  );
}

export class DashboardServer {
  private readonly server: http.Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly dashboardHtml: string;
  private readonly setupHtml: string;
  private readonly callbacks: DashboardCallbacks;
  private rewardsConfig: RewardsFile;
  private effectiveRewards: RewardConfig[];
  private obsScenes: string[];
  private obsUrl: string;
  private twitchConfig: TwitchConfigView;
  private status: DashboardStatus;

  constructor(options: DashboardServerOptions) {
    this.rewardsConfig = options.rewardsConfig;
    this.effectiveRewards = options.effectiveRewards;
    this.obsScenes = options.obsScenes;
    this.obsUrl = options.obsUrl;
    this.twitchConfig = options.twitchConfig;
    this.status = options.status;
    this.callbacks = options.callbacks;

    const publicDir = path.join(__dirname, "..", "public");
    this.dashboardHtml = readFileSync(path.join(publicDir, "dashboard.html"), "utf-8");
    this.setupHtml = readFileSync(path.join(publicDir, "setup.html"), "utf-8");

    this.server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.dashboardHtml);
      } else if (req.url === "/setup" || req.url === "/setup.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.setupHtml);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.send(
        JSON.stringify({
          type: "init",
          status: this.status,
          obsUrl: this.obsUrl,
          obsScenes: this.obsScenes,
          twitchConfig: this.twitchConfig,
          rewardsConfig: this.rewardsConfig,
          effectiveRewards: this.effectiveRewards,
        })
      );

      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.type === "switchScene" && typeof msg.sceneName === "string") {
          this.callbacks.onSwitchScene(msg.sceneName);
        } else if (msg.type === "setPaused" && typeof msg.paused === "boolean") {
          this.callbacks.onSetPaused(msg.paused);
        } else if (msg.type === "connectTwitch") {
          this.callbacks.onConnectTwitch();
        } else if (msg.type === "saveAutoSettings" && isValidAutoSettings(msg.settings)) {
          this.callbacks.onSaveAutoSettings(msg.settings);
        } else if (msg.type === "saveTransitionSettings" && isValidTransitionSettings(msg.settings)) {
          this.callbacks.onSaveTransitionSettings(msg.settings);
        } else if (msg.type === "saveInsta360Settings" && isValidInsta360Settings(msg.settings)) {
          this.callbacks.onSaveInsta360Settings(msg.settings);
        } else if (msg.type === "triggerInsta360Preset" && typeof msg.hotkey === "string") {
          this.callbacks.onTriggerInsta360Preset(msg.hotkey);
        } else if (msg.type === "requestInsta360Hotkeys") {
          this.callbacks.onRequestInsta360Hotkeys();
        } else if (msg.type === "saveObsConfig" && typeof msg.url === "string") {
          this.callbacks.onSaveObsConfig({ url: msg.url, password: typeof msg.password === "string" ? msg.password : "" });
        } else if (msg.type === "saveTwitchConfig" && typeof msg.clientId === "string" && typeof msg.channel === "string") {
          this.callbacks.onSaveTwitchConfig({
            clientId: msg.clientId,
            clientSecret: typeof msg.clientSecret === "string" ? msg.clientSecret : "",
            redirectUri: typeof msg.redirectUri === "string" && msg.redirectUri ? msg.redirectUri : this.twitchConfig.redirectUri,
            channel: msg.channel,
          });
        }
      });

      ws.on("close", () => this.clients.delete(ws));
    });

    this.server.listen(options.port, () => {
      console.log(`[dashboard] listening at http://localhost:${options.port}`);
    });
  }

  updateStatus(partial: Partial<DashboardStatus>): void {
    this.status = { ...this.status, ...partial };
    this.broadcast({ type: "status", status: this.status });
  }

  updateRewardsConfig(rewardsConfig: RewardsFile, effectiveRewards: RewardConfig[]): void {
    this.rewardsConfig = rewardsConfig;
    this.effectiveRewards = effectiveRewards;
    this.broadcast({ type: "rewardsUpdate", rewardsConfig, effectiveRewards });
  }

  updateObsScenes(scenes: string[]): void {
    this.obsScenes = scenes;
    this.broadcast({ type: "obsScenes", scenes });
  }

  updateObsUrl(url: string): void {
    this.obsUrl = url;
    this.broadcast({ type: "obsConfig", url });
  }

  updateTwitchConfig(twitchConfig: TwitchConfigView): void {
    this.twitchConfig = twitchConfig;
    this.broadcast({ type: "twitchConfig", twitchConfig });
  }

  sendTwitchAuthUrl(url: string): void {
    this.broadcast({ type: "twitchAuthUrl", url });
  }

  sendInsta360Hotkeys(result: Insta360HotkeyScanResult): void {
    this.broadcast({ type: "insta360Hotkeys", ...result });
  }

  pushRedemption(entry: RedemptionLogEntry): void {
    this.broadcast({ type: "redemption", entry });
  }

  close(): void {
    this.wss.close();
    this.server.close();
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
