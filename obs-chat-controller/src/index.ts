import { loadConfig } from "./config.js";
import { readRewardsFile, writeRewardsFile, type RewardsFile } from "./configStore.js";
import { deriveAutoRewards, deriveInsta360PresetRewards, deriveTransitionReward } from "./autoRewards.js";
import { updateEnvValues } from "./envStore.js";
import { ObsController } from "./obsController.js";
import { sendHotkey } from "./hotkeySender.js";
import { readConfiguredHotkeys } from "./insta360ControllerConfig.js";
import { TwitchAuth } from "./twitchAuth.js";
import { TwitchApi } from "./twitchApi.js";
import { syncRewards } from "./rewardSync.js";
import { EventSubClient, type RedemptionEvent } from "./eventSubClient.js";
import { SessionLog, type RedemptionLogEntry } from "./sessionLog.js";
import { DashboardServer } from "./dashboardServer.js";
import type { RewardConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const sessionLog = new SessionLog("sessions", new Date());

  const obs = new ObsController();
  let obsUrl = config.obs.url;
  let obsPassword = config.obs.password;
  let obsConnected = false;

  async function connectObs(url: string, password: string): Promise<boolean> {
    try {
      if (obsConnected) {
        await obs.reconnect(url, password);
      } else {
        await obs.connect(url, password);
      }
      obsUrl = url;
      obsPassword = password;
      obsConnected = true;
      console.log(`[obs] connected to ${url}`);
      return true;
    } catch (err) {
      obsConnected = false;
      console.error(`[obs] failed to connect to ${url}:`, err);
      return false;
    }
  }

  console.log(`[obs] connecting to ${obsUrl} ...`);
  await connectObs(obsUrl, obsPassword);

  let rewardsFile: RewardsFile = readRewardsFile();

  function eligibleCameraScenes(): string[] {
    const excluded = new Set(rewardsFile.auto.excludedScenes);
    return obs.listScenes().filter((sceneName) => !excluded.has(sceneName));
  }

  function computeEffectiveRewards(): RewardConfig[] {
    const sceneRewards = deriveAutoRewards(obs.listScenes(), rewardsFile.auto);
    const transitionRewards = deriveTransitionReward(rewardsFile.transition, sceneRewards.length);
    const insta360Rewards = deriveInsta360PresetRewards(rewardsFile.insta360);
    return [...sceneRewards, ...transitionRewards, ...insta360Rewards];
  }

  const initialRewards = computeEffectiveRewards();

  let twitchClientId = config.twitch.clientId;
  let twitchClientSecret = config.twitch.clientSecret;
  let twitchRedirectUri = config.twitch.redirectUri;
  let twitchChannel = config.twitch.channel;

  function isTwitchConfigured(): boolean {
    return Boolean(twitchClientId && twitchClientSecret && twitchChannel);
  }

  let auth = new TwitchAuth(twitchClientId, twitchClientSecret, twitchRedirectUri);
  let api = new TwitchApi(twitchClientId, auth);

  let broadcasterId: string | null = null;
  let rewardIdToConfig = new Map<string, RewardConfig>();
  let eventSub: EventSubClient | null = null;
  let paused = false;
  let twitchConnecting = false;

  const dashboard = new DashboardServer({
    port: config.dashboard.port,
    rewardsConfig: rewardsFile,
    effectiveRewards: initialRewards,
    obsScenes: obs.listScenes(),
    obsUrl,
    twitchConfig: { clientId: twitchClientId, redirectUri: twitchRedirectUri, channel: twitchChannel },
    status: {
      obsConnected,
      twitchConfigured: isTwitchConfigured(),
      twitchAuthorized: auth.hasTokens(),
      twitchConnected: false,
      currentScene: obs.getCurrentScene(),
      paused,
    },
    callbacks: {
      onSwitchScene: (sceneName) => {
        if (!obs.hasScene(sceneName)) {
          console.warn(`[dashboard] requested switch to unknown scene "${sceneName}"`);
          return;
        }
        obs.switchScene(sceneName).catch((err) => {
          console.error(`[dashboard] manual switch to "${sceneName}" failed:`, err);
        });
      },
      onSetPaused: (value) => {
        paused = value;
        console.log(`[dashboard] redemptions ${paused ? "paused" : "resumed"}`);
        dashboard.updateStatus({ paused });
      },
      onConnectTwitch: () => {
        void startTwitchConnection();
      },
      onSaveAutoSettings: (settings) => {
        rewardsFile = { ...rewardsFile, auto: settings };
        writeRewardsFile(rewardsFile);
        console.log("[rewards] saved auto-reward settings from setup page");
        void resyncRewards();
      },
      onSaveTransitionSettings: (settings) => {
        rewardsFile = { ...rewardsFile, transition: settings };
        writeRewardsFile(rewardsFile);
        console.log("[rewards] saved transition-reward settings from setup page");
        void resyncRewards();
      },
      onSaveInsta360Settings: (settings) => {
        rewardsFile = { ...rewardsFile, insta360: settings };
        writeRewardsFile(rewardsFile);
        console.log("[rewards] saved Insta360 preset settings from setup page");
        void resyncRewards();
      },
      onTriggerInsta360Preset: (hotkey) => {
        sendHotkey(hotkey).catch((err) => {
          console.error(`[insta360] failed to trigger preset hotkey "${hotkey}":`, err);
        });
      },
      onRequestInsta360Hotkeys: () => {
        dashboard.sendInsta360Hotkeys(readConfiguredHotkeys());
      },
      onSaveObsConfig: async ({ url, password }) => {
        const effectivePassword = password || obsPassword;
        const success = await connectObs(url, effectivePassword);
        updateEnvValues({ OBS_WEBSOCKET_URL: url, OBS_WEBSOCKET_PASSWORD: effectivePassword });
        dashboard.updateStatus({ obsConnected: success, currentScene: obs.getCurrentScene() });
        dashboard.updateObsUrl(url);
        dashboard.updateObsScenes(obs.listScenes());
        if (success) {
          void resyncRewards();
        }
      },
      onSaveTwitchConfig: ({ clientId, clientSecret, redirectUri, channel }) => {
        twitchClientId = clientId;
        twitchChannel = channel;
        twitchRedirectUri = redirectUri;
        if (clientSecret) twitchClientSecret = clientSecret;

        updateEnvValues({
          TWITCH_CLIENT_ID: twitchClientId,
          TWITCH_CLIENT_SECRET: twitchClientSecret,
          TWITCH_REDIRECT_URI: twitchRedirectUri,
          TWITCH_CHANNEL: twitchChannel,
        });

        auth = new TwitchAuth(twitchClientId, twitchClientSecret, twitchRedirectUri);
        api = new TwitchApi(twitchClientId, auth);
        broadcasterId = null;
        eventSub?.disconnect();
        eventSub = null;

        console.log("[twitch] credentials saved from setup page");
        dashboard.updateTwitchConfig({ clientId: twitchClientId, redirectUri: twitchRedirectUri, channel: twitchChannel });
        dashboard.updateStatus({
          twitchConfigured: isTwitchConfigured(),
          twitchAuthorized: auth.hasTokens(),
          twitchConnected: false,
        });

        if (isTwitchConfigured() && auth.hasTokens()) {
          void startTwitchConnection();
        }
      },
    },
  });

  async function resyncRewards(): Promise<void> {
    const rewards = computeEffectiveRewards();
    dashboard.updateRewardsConfig(rewardsFile, rewards);

    if (broadcasterId) {
      try {
        rewardIdToConfig = await syncRewards(api, broadcasterId, rewards, true);
        console.log(`[rewards] resynced with Twitch (${rewardIdToConfig.size} tracked)`);
      } catch (err) {
        console.error("[rewards] failed to sync rewards with Twitch:", err);
      }
    }
  }

  obs.onConnectionChange((connected) => {
    obsConnected = connected;
    dashboard.updateStatus({ obsConnected: connected });
  });
  obs.onSceneChange((sceneName) => dashboard.updateStatus({ currentScene: sceneName }));
  obs.onSceneListChange((scenes) => {
    dashboard.updateObsScenes(scenes);
    void resyncRewards();
  });

  function logRedemption(entry: RedemptionLogEntry): void {
    sessionLog.record(entry);
    dashboard.pushRedemption(entry);
  }

  async function cancelRedemption(
    broadcasterId: string,
    event: RedemptionEvent,
    sceneName: string,
    reason: string
  ): Promise<void> {
    console.warn(`[redemption] "${event.rewardTitle}" ${reason}, refunding`);
    await api.updateRedemptionStatus(broadcasterId, event.rewardId, event.id, "CANCELED");
    logRedemption({
      timestamp: new Date().toISOString(),
      userName: event.userName,
      rewardTitle: event.rewardTitle,
      sceneName,
      status: "CANCELED",
    });
  }

  async function fulfillRedemption(
    broadcasterId: string,
    event: RedemptionEvent,
    sceneName: string,
    detail?: string
  ): Promise<void> {
    await api.updateRedemptionStatus(broadcasterId, event.rewardId, event.id, "FULFILLED");
    console.log(`[redemption] ${event.userName} redeemed "${event.rewardTitle}" -> switched to "${sceneName}"${detail ? ` ${detail}` : ""}`);
    logRedemption({
      timestamp: new Date().toISOString(),
      userName: event.userName,
      rewardTitle: event.rewardTitle,
      sceneName,
      status: "FULFILLED",
    });
  }

  async function startTwitchConnection(): Promise<void> {
    if (twitchConnecting || broadcasterId) return;
    if (!isTwitchConfigured()) {
      console.log("[twitch] not configured yet — enter credentials on the Setup page");
      return;
    }
    twitchConnecting = true;

    try {
      if (!auth.hasTokens()) {
        await auth.authorize((url) => dashboard.sendTwitchAuthUrl(url));
        dashboard.updateStatus({ twitchAuthorized: true });
      }

      const id = await api.getBroadcasterId(config.twitch.channel);
      broadcasterId = id;
      console.log(`[twitch] broadcaster id: ${id}`);

      await resyncRewards();

      eventSub = new EventSubClient(
        async (sessionId) => {
          await api.createEventSubSubscription(id, sessionId);
          console.log("[eventsub] subscribed to channel point redemptions");
        },
        async (event) => {
          const reward = rewardIdToConfig.get(event.rewardId);
          if (!reward) return;

          if (reward.kind === "scene") {
            const sceneName = reward.sceneName!;

            if (paused) {
              await cancelRedemption(id, event, sceneName, "ignored (redemptions paused)");
              return;
            }

            if (!obs.hasScene(sceneName)) {
              await cancelRedemption(id, event, sceneName, `maps to unknown OBS scene "${sceneName}"`);
              return;
            }

            try {
              await obs.switchScene(sceneName);
              await fulfillRedemption(id, event, sceneName);
            } catch (err) {
              console.error(`[redemption] failed to switch to "${sceneName}":`, err);
              await cancelRedemption(id, event, sceneName, "scene switch failed");
            }
            return;
          }

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

          // Transition reward: no fixed scene, pick a random camera (preferring one
          // different from the current scene) and a random installed OBS transition.
          if (paused) {
            await cancelRedemption(id, event, "(random)", "ignored (redemptions paused)");
            return;
          }

          const candidates = eligibleCameraScenes();
          const otherScenes = candidates.filter((s) => s !== obs.getCurrentScene());
          const scenePool = otherScenes.length > 0 ? otherScenes : candidates;

          if (scenePool.length === 0) {
            await cancelRedemption(id, event, "(random)", "no eligible OBS scenes to transition to");
            return;
          }

          const sceneName = scenePool[Math.floor(Math.random() * scenePool.length)];
          const transitions = obs.listTransitions();
          const transitionName = transitions.length > 0 ? transitions[Math.floor(Math.random() * transitions.length)] : null;

          try {
            if (transitionName) {
              await obs.switchSceneWithTransition(sceneName, transitionName);
            } else {
              await obs.switchScene(sceneName);
            }
            await fulfillRedemption(id, event, sceneName, `via "${transitionName ?? "default"}" transition`);
          } catch (err) {
            console.error(`[redemption] failed to transition to "${sceneName}":`, err);
            await cancelRedemption(id, event, sceneName, "transition switch failed");
          }
        },
        (connected) => dashboard.updateStatus({ twitchConnected: connected })
      );

      eventSub.connect();
    } catch (err) {
      console.error("[twitch] connection failed:", err);
      broadcasterId = null;
      dashboard.updateStatus({ twitchAuthorized: auth.hasTokens(), twitchConnected: false });
    } finally {
      twitchConnecting = false;
    }
  }

  if (!isTwitchConfigured()) {
    console.log("[twitch] no credentials configured yet — open the dashboard's Setup page to enter them");
  } else if (auth.hasTokens()) {
    void startTwitchConnection();
  } else {
    console.log("[twitch] not yet authorized — open the dashboard's Setup page to connect");
  }

  const shutdown = async () => {
    console.log("\nShutting down...");
    sessionLog.printSummary();
    eventSub?.disconnect();
    dashboard.close();
    await obs.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
