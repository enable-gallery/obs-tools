import { TwitchRewardsClient, syncRewards } from "@obs-tools/twitch-rewards";
import type { ChatCommandContext, ChatCommandResult } from "../../chatController.js";
import type { ObsToolModule, ModuleContext, ModuleInstance } from "../../types.js";
import { deriveAutoRewards, deriveTransitionReward } from "./autoRewards.js";
import { DEFAULT_AUTO_SETTINGS, DEFAULT_TRANSITION_SETTINGS } from "./types.js";
import type { RewardConfig, RewardsFile } from "./types.js";

export const cameraSwitcherModule: ObsToolModule = {
  id: "camera-switcher",
  requires: {
    obs: true,
    twitch: { scopes: ["channel:read:redemptions", "channel:manage:redemptions"] },
    chat: true,
  },

  async init(ctx: ModuleContext): Promise<ModuleInstance> {
    if (!ctx.obs) throw new Error("camera-switcher requires OBS to be configured");
    if (!ctx.twitch) throw new Error("camera-switcher requires Twitch to be configured");
    if (!ctx.chat) throw new Error("camera-switcher requires chat-controller to be configured");

    const obs = ctx.obs;
    const chat = ctx.chat;
    const { clientId, auth, broadcasterId } = ctx.twitch;

    const stored = ctx.config.read() as Partial<RewardsFile>;
    const rewardsFile: RewardsFile = {
      auto: { ...DEFAULT_AUTO_SETTINGS, ...stored.auto },
      transition: { ...DEFAULT_TRANSITION_SETTINGS, ...stored.transition },
    };

    const rewardsClient = new TwitchRewardsClient(clientId, auth);

    let rewardIdToConfig = new Map<string, RewardConfig>();

    function eligibleCameraScenes(): string[] {
      const excluded = new Set(rewardsFile.auto.excludedScenes);
      return obs.listScenes().filter((sceneName) => !excluded.has(sceneName));
    }

    function computeEffectiveRewards(): RewardConfig[] {
      const sceneRewards = deriveAutoRewards(obs.listScenes(), rewardsFile.auto);
      const transitionRewards = deriveTransitionReward(rewardsFile.transition, sceneRewards.length);
      return [...sceneRewards, ...transitionRewards];
    }

    async function resyncRewards(): Promise<void> {
      const rewards = computeEffectiveRewards();
      try {
        rewardIdToConfig = await syncRewards(rewardsClient, broadcasterId, rewards, true);
        console.log(`[camera-switcher] resynced with Twitch (${rewardIdToConfig.size} tracked)`);
        for (const rewardId of rewardIdToConfig.keys()) {
          chat.registerRewardCommand(rewardId, handleRedemption);
        }
      } catch (err) {
        console.error("[camera-switcher] failed to sync rewards with Twitch:", err);
      }
    }

    async function handleRedemption(cmdCtx: ChatCommandContext): Promise<ChatCommandResult> {
      const reward = rewardIdToConfig.get(cmdCtx.rewardId!);
      if (!reward) return { ok: false, reason: "reward is no longer tracked" };

      if (reward.kind === "scene") {
        const sceneName = reward.sceneName!;

        if (!obs.hasScene(sceneName)) {
          return { ok: false, reason: `maps to unknown OBS scene "${sceneName}"` };
        }

        try {
          await obs.switchScene(sceneName);
          console.log(`[camera-switcher] ${cmdCtx.userName} switched to "${sceneName}"`);
          return { ok: true, detail: sceneName };
        } catch (err) {
          console.error(`[camera-switcher] failed to switch to "${sceneName}":`, err);
          return { ok: false, reason: "scene switch failed" };
        }
      }

      // Transition reward: no fixed scene, pick a random camera (preferring
      // one different from the current scene) and a random installed OBS transition.
      const candidates = eligibleCameraScenes();
      const otherScenes = candidates.filter((s) => s !== obs.getCurrentScene());
      const scenePool = otherScenes.length > 0 ? otherScenes : candidates;

      if (scenePool.length === 0) {
        return { ok: false, reason: "no eligible OBS scenes to transition to" };
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
        const detail = `switched to "${sceneName}" via "${transitionName ?? "default"}" transition`;
        console.log(`[camera-switcher] ${cmdCtx.userName} ${detail}`);
        return { ok: true, detail };
      } catch (err) {
        console.error(`[camera-switcher] failed to transition to "${sceneName}":`, err);
        return { ok: false, reason: "transition switch failed" };
      }
    }

    await resyncRewards();

    obs.onSceneListChange(() => {
      void resyncRewards();
    });

    // OBS may not have been connected yet at init() time (host doesn't wait
    // for it) — onSceneListChange alone won't fire for the initial connect,
    // so resync again once it actually comes up.
    obs.onConnectionChange((connected) => {
      if (connected) void resyncRewards();
    });

    return {
      async start(): Promise<void> {
        console.log(
          `[camera-switcher] watching ${rewardIdToConfig.size} reward(s) across ${obs.listScenes().length} OBS scene(s)`
        );
      },
      async stop(): Promise<void> {
        // No per-module teardown needed — the host closes the shared OBS/EventSub connections.
      },
      async onConfigChanged(): Promise<void> {
        const stored = ctx.config.read() as Partial<RewardsFile>;
        rewardsFile.auto = { ...DEFAULT_AUTO_SETTINGS, ...stored.auto };
        rewardsFile.transition = { ...DEFAULT_TRANSITION_SETTINGS, ...stored.transition };
        await resyncRewards();
      },
    };
  },
};
