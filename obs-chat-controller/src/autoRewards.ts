import type { RewardConfig } from "./config.js";
import type { AutoRewardSettings, Insta360RewardSettings, TransitionRewardSettings } from "./configStore.js";

export function deriveAutoRewards(sceneNames: string[], settings: AutoRewardSettings): RewardConfig[] {
  const excluded = new Set(settings.excludedScenes);

  return sceneNames
    .filter((sceneName) => !excluded.has(sceneName))
    .map((sceneName) => ({
      title: settings.titleTemplate.replace("{scene}", sceneName),
      prompt: settings.promptTemplate.replace("{scene}", sceneName),
      cost: settings.cost,
      kind: "scene" as const,
      sceneName,
      globalCooldownSeconds: settings.globalCooldownSeconds,
      backgroundColor: settings.backgroundColor,
    }));
}

export function deriveTransitionReward(settings: TransitionRewardSettings, eligibleSceneCount: number): RewardConfig[] {
  if (!settings.enabled || eligibleSceneCount < 2) return [];

  return [
    {
      title: settings.title,
      prompt: settings.prompt,
      cost: settings.cost,
      kind: "transition" as const,
      globalCooldownSeconds: settings.globalCooldownSeconds,
      backgroundColor: settings.backgroundColor,
    },
  ];
}

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
