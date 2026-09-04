import { DashboardServer } from "./dashboardServer.js";
import { deriveAutoRewards, deriveInsta360PresetRewards, deriveTransitionReward } from "./autoRewards.js";
import {
  DEFAULT_AUTO_SETTINGS,
  DEFAULT_INSTA360_SETTINGS,
  DEFAULT_TRANSITION_SETTINGS,
  type RewardsFile,
} from "./configStore.js";

const FAKE_OBS_SCENES = ["Cam 1", "Cam 2", "Wide Shot", "Starting Soon"];

let obsScenes: string[] = [];

let rewardsFile: RewardsFile = {
  auto: DEFAULT_AUTO_SETTINGS,
  transition: DEFAULT_TRANSITION_SETTINGS,
  insta360: DEFAULT_INSTA360_SETTINGS,
};

function computeEffectiveRewards() {
  const sceneRewards = deriveAutoRewards(obsScenes, rewardsFile.auto);
  const transitionRewards = deriveTransitionReward(rewardsFile.transition, sceneRewards.length);
  const insta360Rewards = deriveInsta360PresetRewards(rewardsFile.insta360);
  return [...sceneRewards, ...transitionRewards, ...insta360Rewards];
}

let paused = false;
let currentScene = "Cam 1";
let twitchConfigured = false;
let twitchAuthorized = false;
let obsConnected = false;
let obsUrl = "ws://127.0.0.1:4455";
let twitchClientId = "";
let twitchChannel = "";
let twitchRedirectUri = "http://localhost:3000/callback";

const port = Number(process.env.DASHBOARD_PORT) || 4510;

const dashboard = new DashboardServer({
  port,
  rewardsConfig: rewardsFile,
  effectiveRewards: computeEffectiveRewards(),
  obsScenes,
  obsUrl,
  twitchConfig: { clientId: twitchClientId, redirectUri: twitchRedirectUri, channel: twitchChannel },
  status: { obsConnected, twitchConfigured, twitchAuthorized, twitchConnected: false, currentScene, paused },
  callbacks: {
    onSwitchScene: (sceneName: string) => {
      currentScene = sceneName;
      console.log(`[demo] switched to "${sceneName}"`);
      dashboard.updateStatus({ currentScene });
    },
    onSetPaused: (value: boolean) => {
      paused = value;
      console.log(`[demo] paused: ${paused}`);
      dashboard.updateStatus({ paused });
    },
    onConnectTwitch: () => {
      console.log("[demo] pretending to authorize with Twitch...");
      setTimeout(() => {
        twitchAuthorized = true;
        dashboard.updateStatus({ twitchAuthorized: true, twitchConnected: true });
        console.log("[demo] fake Twitch connection established");
      }, 1500);
    },
    onSaveTwitchConfig: ({ clientId, channel, redirectUri }) => {
      twitchClientId = clientId;
      twitchChannel = channel;
      twitchRedirectUri = redirectUri;
      twitchConfigured = Boolean(clientId && channel);
      console.log(`[demo] saved fake Twitch config for channel "${channel}"`);
      dashboard.updateTwitchConfig({ clientId, redirectUri, channel });
      dashboard.updateStatus({ twitchConfigured });
    },
    onSaveAutoSettings: (settings) => {
      rewardsFile = { ...rewardsFile, auto: settings };
      console.log("[demo] saved auto-reward settings");
      dashboard.updateRewardsConfig(rewardsFile, computeEffectiveRewards());
    },
    onSaveTransitionSettings: (settings) => {
      rewardsFile = { ...rewardsFile, transition: settings };
      console.log("[demo] saved transition-reward settings");
      dashboard.updateRewardsConfig(rewardsFile, computeEffectiveRewards());
    },
    onSaveInsta360Settings: (settings) => {
      rewardsFile = { ...rewardsFile, insta360: settings };
      console.log("[demo] saved Insta360 preset settings");
      dashboard.updateRewardsConfig(rewardsFile, computeEffectiveRewards());
    },
    onTriggerInsta360Preset: (hotkey) => {
      console.log(`[demo] pretending to send hotkey "${hotkey}" to Insta360 Link Controller`);
    },
    onRequestInsta360Hotkeys: () => {
      console.log("[demo] pretending to scan Insta360 Link Controller for configured hotkeys");
      dashboard.sendInsta360Hotkeys({
        found: true,
        hotkeys: [
          { key: "Device1", hotkey: "ctrl+alt+1" },
          { key: "Device2", hotkey: "ctrl+alt+2" },
        ],
      });
    },
    onSaveObsConfig: (payload: { url: string; password: string }) => {
      obsUrl = payload.url;
      console.log(`[demo] pretending to connect to OBS at ${obsUrl}...`);
      setTimeout(() => {
        obsConnected = true;
        obsScenes = FAKE_OBS_SCENES;
        dashboard.updateStatus({ obsConnected: true });
        dashboard.updateObsUrl(obsUrl);
        dashboard.updateObsScenes(obsScenes);
        dashboard.updateRewardsConfig(rewardsFile, computeEffectiveRewards());
        console.log("[demo] fake OBS connection established, scenes populated");
      }, 1000);
    },
  },
});

console.log(`Demo dashboard running at http://localhost:${port} with fake data (no OBS/Twitch connection needed).`);
console.log("Controller page, Setup page, auto-reward settings, and manual switch/pause all work against fake state.");

process.on("SIGINT", () => {
  dashboard.close();
  process.exit(0);
});
