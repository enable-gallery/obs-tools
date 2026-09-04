import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config.json");

export interface AutoRewardSettings {
  cost: number;
  globalCooldownSeconds: number;
  backgroundColor: string;
  titleTemplate: string;
  promptTemplate: string;
  excludedScenes: string[];
}

export const DEFAULT_AUTO_SETTINGS: AutoRewardSettings = {
  cost: 150,
  globalCooldownSeconds: 30,
  backgroundColor: "#9147FF",
  titleTemplate: "Switch to {scene}",
  promptTemplate: "Switch the stream camera to {scene}",
  excludedScenes: [],
};

export interface TransitionRewardSettings {
  enabled: boolean;
  cost: number;
  globalCooldownSeconds: number;
  backgroundColor: string;
  title: string;
  prompt: string;
}

export const DEFAULT_TRANSITION_SETTINGS: TransitionRewardSettings = {
  enabled: true,
  cost: 500,
  globalCooldownSeconds: 60,
  backgroundColor: "#FF4500",
  title: "Random Transition Cam Switch",
  prompt: "Switch camera using a random OBS transition",
};

export interface Insta360Preset {
  name: string;
  hotkey: string;
}

export interface Insta360RewardSettings {
  enabled: boolean;
  cost: number;
  globalCooldownSeconds: number;
  backgroundColor: string;
  titleTemplate: string;
  promptTemplate: string;
  presets: Insta360Preset[];
}

export const DEFAULT_INSTA360_SETTINGS: Insta360RewardSettings = {
  enabled: false,
  cost: 200,
  globalCooldownSeconds: 30,
  backgroundColor: "#1E90FF",
  titleTemplate: "Camera preset: {preset}",
  promptTemplate: "Move the Insta360 Link camera to the {preset} preset",
  presets: [],
};

export interface RewardsFile {
  auto: AutoRewardSettings;
  transition: TransitionRewardSettings;
  insta360: Insta360RewardSettings;
}

export function readRewardsFile(): RewardsFile {
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<RewardsFile>;
  return {
    auto: { ...DEFAULT_AUTO_SETTINGS, ...parsed.auto },
    transition: { ...DEFAULT_TRANSITION_SETTINGS, ...parsed.transition },
    insta360: { ...DEFAULT_INSTA360_SETTINGS, ...parsed.insta360 },
  };
}

export function writeRewardsFile(data: RewardsFile): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n");
}
