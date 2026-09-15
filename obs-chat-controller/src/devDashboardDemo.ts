import { DashboardServer } from "./dashboardServer.js";
import { deriveAutoRewards, deriveTransitionReward } from "./autoRewards.js";
import {
  DEFAULT_AUTO_SETTINGS,
  DEFAULT_TRANSITION_SETTINGS,
  type RewardsFile,
} from "./configStore.js";

const FAKE_OBS_SCENES = ["Cam 1", "Cam 2", "Wide Shot", "Starting Soon"];

let obsScenes: string[] = [];

let rewardsFile: RewardsFile = {
  auto: DEFAULT_AUTO_SETTINGS,
  transition: DEFAULT_TRANSITION_SETTINGS,
};

function computeEffectiveRewards() {
  const sceneRewards = deriveAutoRewards(obsScenes, rewardsFile.auto);
  const transitionRewards = deriveTransitionReward(rewardsFile.transition, sceneRewards.length);
  return [...sceneRewards, ...transitionRewards];
}

let paused = false;
let pausedEdit = false;
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
  status: { obsConnected, twitchConfigured, twitchAuthorized, twitchConnected: false, currentScene, paused, pausedEdit },
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
    onSetPausedEdit: (value: boolean) => {
      pausedEdit = value;
      console.log(`[demo] edit paused: ${pausedEdit}`);
      dashboard.updateStatus({ pausedEdit });
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
    onRefreshObsScenes: () => {
      if (!obsConnected) {
        console.log("[demo] can't refresh scenes, not connected");
        return;
      }
      console.log("[demo] pretending to refresh scene list from OBS...");
      setTimeout(() => {
        obsScenes = [...FAKE_OBS_SCENES, "Refreshed Cam"];
        dashboard.updateObsScenes(obsScenes);
        dashboard.updateRewardsConfig(rewardsFile, computeEffectiveRewards());
        console.log("[demo] fake scene list refreshed");
      }, 500);
    },
  },
});

console.log(`Demo dashboard running at http://localhost:${port} with fake data (no OBS/Twitch connection needed).`);
console.log("Controller page, Setup page, auto-reward settings, and manual switch/pause all work against fake state.");

process.on("SIGINT", () => {
  dashboard.close();
  process.exit(0);
});
