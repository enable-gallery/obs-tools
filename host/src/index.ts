import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, GatewayIntentBits } from "discord.js";
import { loadEnvConfig } from "./config.js";
import { loadEnabledModuleIds, createModuleConfigStore, loadConnectorFlags, saveConnectorFlags } from "./configStore.js";
import { updateEnvValues } from "./envStore.js";
import { ObsController } from "@obs-tools/obs-client";
import { TwitchAuth, TwitchHelixClient, getAuthorizedUser } from "@obs-tools/twitch-auth";
import { TwitchEventSubClient } from "@obs-tools/twitch-eventsub";
import { SessionLog } from "@obs-tools/session-log";
import { createChatController, REQUIRED_CHAT_SCOPES, type ChatController } from "./chatController.js";
import { SetupServer, type SetupStatus } from "./setupServer.js";
import type { ObsToolModule, ModuleContext, ModuleInstance, TwitchContext } from "./types.js";
import { streamStatusLoggerModule } from "./modules/streamStatusLogger.js";
import { cameraSwitcherModule } from "./modules/cameraSwitcher/index.js";
import { discordNotifyModule, DEFAULT_CONFIG as DISCORD_NOTIFY_DEFAULTS } from "./modules/discordNotify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");
const TOKEN_FILE = path.join(__dirname, "..", ".twitch-tokens.json");

const MODULE_REGISTRY: ObsToolModule[] = [streamStatusLoggerModule, cameraSwitcherModule, discordNotifyModule];

async function main(): Promise<void> {
  const env = loadEnvConfig();
  const enabledIds = loadEnabledModuleIds();
  const modules = MODULE_REGISTRY.filter((m) => enabledIds.has(m.id));

  if (modules.length === 0) {
    console.log("[host] no modules enabled in config.json — nothing to do");
    return;
  }
  console.log(`[host] enabled modules: ${modules.map((m) => m.id).join(", ")}`);

  const sessionLog = new SessionLog(SESSIONS_DIR, new Date());
  const discordNotifyConfigStore = createModuleConfigStore("discord-notify", DISCORD_NOTIFY_DEFAULTS);

  // Persisted "keep this connected even without a module needing it" flags,
  // toggled from the setup page — lets a connection be tested/established
  // independent of which modules are enabled.
  const connectorFlags = loadConnectorFlags();

  const needsChat = modules.some((m) => m.requires.chat);
  const twitchModules = modules.filter((m) => m.requires.twitch);

  function obsIsNeeded(): boolean {
    return modules.some((m) => m.requires.obs) || connectorFlags.obs;
  }
  function twitchIsNeeded(): boolean {
    return twitchModules.length > 0 || needsChat || connectorFlags.twitch;
  }
  function discordIsNeeded(): boolean {
    return modules.some((m) => m.requires.discord) || connectorFlags.discord;
  }

  const twitchScopes = new Set(twitchModules.flatMap((m) => m.requires.twitch!.scopes));
  if (needsChat) {
    for (const scope of REQUIRED_CHAT_SCOPES) twitchScopes.add(scope);
  }

  // Mutable connection state — the setup page can (re)configure any of
  // these live, without restarting the process.
  let twitchClientId = env.twitch.clientId;
  let discordBotToken = env.discord.botToken;
  let obsUrl = env.obs.url;
  let obsPassword = env.obs.password;

  // Always constructed (cheap, no network cost until connect() is called) so
  // the setup page's OBS panel can always test/establish a connection, even
  // if no enabled module currently requires OBS.
  const obs = new ObsController();
  let obsConnected = false;

  async function connectObs(url: string, password: string): Promise<boolean> {
    try {
      if (obsConnected) {
        await obs.reconnect(url, password);
      } else {
        await obs.connect(url, password);
      }
      obsConnected = true;
      console.log(`[obs] connected to ${url}`);
      return true;
    } catch (err) {
      obsConnected = false;
      console.error(`[obs] failed to connect to ${url}:`, err);
      return false;
    }
  }

  let twitch: TwitchContext | undefined;
  let chat: ChatController | undefined;
  let twitchConnecting = false;

  let discord: Client | undefined;
  let discordConnecting = false;

  const instances: ModuleInstance[] = [];
  const instancesById = new Map<string, ModuleInstance>();
  const initializedIds = new Set<string>();

  function isTwitchConfigured(): boolean {
    return Boolean(twitchClientId);
  }

  function isDiscordConfigured(): boolean {
    return Boolean(discordBotToken);
  }

  /** Initializes any enabled module whose required contexts are all available now. Safe to call repeatedly. */
  async function tryInitReadyModules(): Promise<void> {
    for (const mod of modules) {
      if (initializedIds.has(mod.id)) continue;
      if (mod.requires.twitch && !twitch) continue;
      if (mod.requires.chat && !chat) continue;
      if (mod.requires.discord && !discord) continue;

      const ctx: ModuleContext = {
        obs: mod.requires.obs ? obs : undefined,
        twitch: mod.requires.twitch ? twitch : undefined,
        discord: mod.requires.discord ? discord : undefined,
        chat: mod.requires.chat ? chat : undefined,
        sessionLog,
        config: createModuleConfigStore(mod.id, {}),
      };

      console.log(`[host] initializing module "${mod.id}"...`);
      try {
        const instance = await mod.init(ctx);
        await instance.start();
        instances.push(instance);
        instancesById.set(mod.id, instance);
        initializedIds.add(mod.id);
      } catch (err) {
        console.error(`[host] failed to initialize module "${mod.id}":`, err);
      }
    }
  }

  async function connectTwitch(): Promise<void> {
    if (!twitchIsNeeded() || twitchConnecting || twitch) return;
    if (!isTwitchConfigured()) {
      console.log("[twitch] not configured yet — open the setup page to enter credentials");
      return;
    }
    twitchConnecting = true;

    try {
      const auth = new TwitchAuth({
        clientId: twitchClientId,
        scopes: [...twitchScopes],
        tokenFile: TOKEN_FILE,
      });
      const helix = new TwitchHelixClient(twitchClientId, auth);
      const eventSub = new TwitchEventSubClient(helix);
      eventSub.onConnectionChange((connected) => {
        setupServer.updateStatus({ twitchConnected: connected });
      });

      if (!auth.hasTokens()) {
        await auth.authorize((info) => setupServer.sendTwitchDeviceCode(info));
      }
      setupServer.updateStatus({ twitchAuthorized: true });

      const user = await getAuthorizedUser(helix);
      console.log(`[twitch] authorized as ${user.login}`);

      eventSub.connect();
      twitch = { clientId: twitchClientId, auth, helix, eventSub, channel: user.login, broadcasterId: user.id };

      if (needsChat) {
        chat = await createChatController(twitch, sessionLog);
      }

      await tryInitReadyModules();
    } catch (err) {
      console.error("[twitch] connection failed:", err);
      setupServer.updateStatus({ twitchAuthorized: false, twitchConnected: false });
    } finally {
      twitchConnecting = false;
    }
  }

  async function connectDiscord(): Promise<void> {
    if (!discordIsNeeded() || discordConnecting || discord) return;
    if (!isDiscordConfigured()) {
      console.log("[discord] not configured yet — open the setup page to enter a bot token");
      return;
    }
    discordConnecting = true;

    try {
      const client = new Client({ intents: [GatewayIntentBits.Guilds] });
      await new Promise<void>((resolve, reject) => {
        client.once("ready", () => resolve());
        client.once("error", reject);
        client.login(discordBotToken).catch(reject);
      });
      discord = client;
      console.log(`[discord] logged in as ${discord.user?.tag}`);
      setupServer.updateStatus({ discordConnected: true });
      await tryInitReadyModules();
    } catch (err) {
      console.error("[discord] connection failed:", err);
    } finally {
      discordConnecting = false;
    }
  }

  /**
   * Stops and un-registers already-initialized modules matching `predicate`,
   * so tryInitReadyModules() will re-init them (with a fresh ctx) once their
   * connector reconnects. Needed because twitch/discord are replaced with a
   * brand-new client object on reconnect — a module that already captured
   * the old one in its closure would otherwise keep using a dead client.
   */
  async function deinitModules(predicate: (mod: ObsToolModule) => boolean): Promise<void> {
    for (const mod of modules) {
      if (!initializedIds.has(mod.id) || !predicate(mod)) continue;
      const instance = instancesById.get(mod.id);
      if (instance) {
        try {
          await instance.stop();
        } catch (err) {
          console.error(`[host] error stopping module "${mod.id}":`, err);
        }
        const idx = instances.indexOf(instance);
        if (idx !== -1) instances.splice(idx, 1);
        instancesById.delete(mod.id);
      }
      initializedIds.delete(mod.id);
    }
  }

  async function runModuleTest(moduleId: string): Promise<void> {
    const instance = instancesById.get(moduleId);
    if (!instance?.test) {
      setupServer.reportModuleTestResult({
        moduleId,
        ok: false,
        message: "module isn't running (check its connection/credentials) or has no test action",
      });
      return;
    }
    try {
      await instance.test();
      setupServer.reportModuleTestResult({ moduleId, ok: true, message: "sent" });
    } catch (err) {
      setupServer.reportModuleTestResult({
        moduleId,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const setupServer = new SetupServer({
    port: env.setupPort,
    obsUrl,
    twitchConfig: { clientId: twitchClientId },
    discordNotifyConfig: discordNotifyConfigStore.read(),
    status: {
      obsConnected,
      obsEnabled: connectorFlags.obs,
      twitchConfigured: isTwitchConfigured(),
      twitchAuthorized: false,
      twitchConnected: false,
      twitchEnabled: connectorFlags.twitch,
      discordConfigured: isDiscordConfigured(),
      discordConnected: false,
      discordEnabled: connectorFlags.discord,
    },
    callbacks: {
      onConnectTwitch: () => {
        void connectTwitch();
      },
      onSaveObsConfig: async ({ url, password }) => {
        const effectivePassword = password || obsPassword;
        const success = await connectObs(url, effectivePassword);
        obsUrl = url;
        obsPassword = effectivePassword;
        updateEnvValues({ OBS_WEBSOCKET_URL: url, OBS_WEBSOCKET_PASSWORD: effectivePassword });
        setupServer.updateStatus({ obsConnected: success });
        setupServer.updateObsUrl(url);
        if (success) void tryInitReadyModules();
      },
      onSaveTwitchConfig: ({ clientId }) => {
        twitchClientId = clientId;

        updateEnvValues({ TWITCH_CLIENT_ID: twitchClientId });

        void (async () => {
          await deinitModules((m) => Boolean(m.requires.twitch) || Boolean(m.requires.chat));

          twitch?.eventSub.disconnect();
          twitch = undefined;
          chat = undefined;

          console.log("[twitch] client id saved from setup page");
          setupServer.updateTwitchConfig({ clientId: twitchClientId });
          setupServer.updateStatus({
            twitchConfigured: isTwitchConfigured(),
            twitchAuthorized: false,
            twitchConnected: false,
          });

          void connectTwitch();
        })();
      },
      onSaveDiscordConfig: ({ botToken }) => {
        if (botToken) discordBotToken = botToken;
        updateEnvValues({ DISCORD_BOT_TOKEN: discordBotToken });

        void (async () => {
          await deinitModules((m) => Boolean(m.requires.discord));

          await discord?.destroy();
          discord = undefined;

          console.log("[discord] bot token saved from setup page");
          setupServer.updateStatus({ discordConfigured: isDiscordConfigured(), discordConnected: false });

          void connectDiscord();
        })();
      },
      onSaveDiscordNotifyConfig: ({ channelId, messageTemplate }) => {
        const config = { channelId, messageTemplate: messageTemplate || DISCORD_NOTIFY_DEFAULTS.messageTemplate };
        discordNotifyConfigStore.write(config);
        console.log("[discord-notify] config saved from setup page");
        setupServer.updateDiscordNotifyConfig(config);
      },
      onSetConnectorEnabled: ({ connector, enabled }) => {
        connectorFlags[connector] = enabled;
        saveConnectorFlags(connectorFlags);
        setupServer.updateStatus({ [`${connector}Enabled`]: enabled } as Partial<SetupStatus>);

        if (!enabled) return;

        if (connector === "obs") {
          void (async () => {
            const success = await connectObs(obsUrl, obsPassword);
            setupServer.updateStatus({ obsConnected: success });
            if (success) void tryInitReadyModules();
          })();
        } else if (connector === "twitch") {
          void connectTwitch();
        } else {
          void connectDiscord();
        }
      },
      onRunModuleTest: ({ moduleId }) => {
        void runModuleTest(moduleId);
      },
    },
  });

  if (obsIsNeeded()) {
    console.log(`[obs] connecting to ${obsUrl} ...`);
    const success = await connectObs(obsUrl, obsPassword);
    setupServer.updateStatus({ obsConnected: success });
  }

  await connectTwitch();
  await connectDiscord();
  await tryInitReadyModules();

  console.log(
    `[host] ${initializedIds.size}/${modules.length} module(s) initialized` +
      (initializedIds.size < modules.length ? " — open the setup page for anything still waiting on credentials" : "")
  );

  const shutdown = async () => {
    console.log("\n[host] shutting down...");
    sessionLog.printSummary();
    for (const instance of instances) {
      await instance.stop();
    }
    twitch?.eventSub.disconnect();
    await obs?.disconnect();
    await discord?.destroy();
    setupServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
