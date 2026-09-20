export interface RewardConfig {
  title: string;
  prompt?: string;
  cost: number;
  kind: "scene" | "transition";
  sceneName?: string;
  globalCooldownSeconds?: number;
  backgroundColor?: string;
}

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

export interface RewardsFile {
  auto: AutoRewardSettings;
  transition: TransitionRewardSettings;
}
