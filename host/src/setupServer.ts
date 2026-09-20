import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ConnectorName = "obs" | "twitch" | "discord";

export interface SetupStatus {
  obsConnected: boolean;
  obsEnabled: boolean;
  twitchConfigured: boolean;
  twitchAuthorized: boolean;
  twitchConnected: boolean;
  twitchEnabled: boolean;
  discordConfigured: boolean;
  discordConnected: boolean;
  discordEnabled: boolean;
}

export interface SaveObsConfigPayload {
  url: string;
  password: string;
}

export interface SaveTwitchConfigPayload {
  clientId: string;
}

export interface SaveDiscordConfigPayload {
  botToken: string;
}

export interface SaveDiscordNotifyConfigPayload {
  channelId: string;
  messageTemplate: string;
}

export interface SetConnectorEnabledPayload {
  connector: ConnectorName;
  enabled: boolean;
}

export interface RunModuleTestPayload {
  moduleId: string;
}

export interface ModuleTestResult {
  moduleId: string;
  ok: boolean;
  message: string;
}

export interface TwitchConfigView {
  clientId: string;
}

export interface DiscordNotifyConfigView {
  channelId: string;
  messageTemplate: string;
}

export interface SetupCallbacks {
  onConnectTwitch: () => void;
  onSaveObsConfig: (payload: SaveObsConfigPayload) => void;
  onSaveTwitchConfig: (payload: SaveTwitchConfigPayload) => void;
  onSaveDiscordConfig: (payload: SaveDiscordConfigPayload) => void;
  onSaveDiscordNotifyConfig: (payload: SaveDiscordNotifyConfigPayload) => void;
  onSetConnectorEnabled: (payload: SetConnectorEnabledPayload) => void;
  onRunModuleTest: (payload: RunModuleTestPayload) => void;
}

export interface SetupServerOptions {
  port: number;
  obsUrl: string;
  twitchConfig: TwitchConfigView;
  discordNotifyConfig: DiscordNotifyConfigView;
  status: SetupStatus;
  callbacks: SetupCallbacks;
}

/**
 * Minimal setup page for entering OBS/Twitch/Discord connection credentials
 * at runtime instead of hand-editing host/.env. Also exposes a few
 * module-specific settings (currently just discord-notify's channel/template)
 * that are awkward to hand-edit in host/config.json; most module config still
 * lives there.
 */
export class SetupServer {
  private readonly server: http.Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly setupHtml: string;
  private readonly callbacks: SetupCallbacks;
  private obsUrl: string;
  private twitchConfig: TwitchConfigView;
  private discordNotifyConfig: DiscordNotifyConfigView;
  private status: SetupStatus;

  constructor(options: SetupServerOptions) {
    this.obsUrl = options.obsUrl;
    this.twitchConfig = options.twitchConfig;
    this.discordNotifyConfig = options.discordNotifyConfig;
    this.status = options.status;
    this.callbacks = options.callbacks;

    const publicDir = path.join(__dirname, "..", "public");
    this.setupHtml = readFileSync(path.join(publicDir, "setup.html"), "utf-8");

    this.server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/setup.html") {
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
          twitchConfig: this.twitchConfig,
          discordNotifyConfig: this.discordNotifyConfig,
        })
      );

      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.type === "connectTwitch") {
          this.callbacks.onConnectTwitch();
        } else if (msg.type === "saveObsConfig" && typeof msg.url === "string") {
          this.callbacks.onSaveObsConfig({ url: msg.url, password: typeof msg.password === "string" ? msg.password : "" });
        } else if (msg.type === "saveTwitchConfig" && typeof msg.clientId === "string") {
          this.callbacks.onSaveTwitchConfig({ clientId: msg.clientId });
        } else if (msg.type === "saveDiscordConfig") {
          this.callbacks.onSaveDiscordConfig({ botToken: typeof msg.botToken === "string" ? msg.botToken : "" });
        } else if (msg.type === "saveDiscordNotifyConfig") {
          this.callbacks.onSaveDiscordNotifyConfig({
            channelId: typeof msg.channelId === "string" ? msg.channelId : "",
            messageTemplate: typeof msg.messageTemplate === "string" ? msg.messageTemplate : "",
          });
        } else if (
          msg.type === "setConnectorEnabled" &&
          (msg.connector === "obs" || msg.connector === "twitch" || msg.connector === "discord") &&
          typeof msg.enabled === "boolean"
        ) {
          this.callbacks.onSetConnectorEnabled({ connector: msg.connector, enabled: msg.enabled });
        } else if (msg.type === "runModuleTest" && typeof msg.moduleId === "string") {
          this.callbacks.onRunModuleTest({ moduleId: msg.moduleId });
        }
      });

      ws.on("close", () => this.clients.delete(ws));
    });

    this.server.listen(options.port, () => {
      console.log(`[setup] listening at http://localhost:${options.port}`);
    });
  }

  updateStatus(partial: Partial<SetupStatus>): void {
    this.status = { ...this.status, ...partial };
    this.broadcast({ type: "status", status: this.status });
  }

  updateObsUrl(url: string): void {
    this.obsUrl = url;
    this.broadcast({ type: "obsConfig", url });
  }

  updateTwitchConfig(twitchConfig: TwitchConfigView): void {
    this.twitchConfig = twitchConfig;
    this.broadcast({ type: "twitchConfig", twitchConfig });
  }

  updateDiscordNotifyConfig(discordNotifyConfig: DiscordNotifyConfigView): void {
    this.discordNotifyConfig = discordNotifyConfig;
    this.broadcast({ type: "discordNotifyConfig", discordNotifyConfig });
  }

  reportModuleTestResult(result: ModuleTestResult): void {
    this.broadcast({ type: "moduleTestResult", ...result });
  }

  sendTwitchDeviceCode(info: { verificationUri: string; userCode: string; expiresInSeconds: number }): void {
    this.broadcast({ type: "twitchDeviceCode", ...info });
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
