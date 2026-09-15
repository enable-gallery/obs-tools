import "dotenv/config";

export interface RewardConfig {
  title: string;
  prompt?: string;
  cost: number;
  kind: "scene" | "transition";
  sceneName?: string;
  globalCooldownSeconds?: number;
  backgroundColor?: string;
}

export interface AppConfig {
  twitch: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    channel: string;
  };
  obs: {
    url: string;
    password: string;
  };
  dashboard: {
    port: number;
  };
}

/** Accepts a bare login, a full channel URL, or one with the protocol/www omitted, and returns just the login. */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?twitch\.tv\//i, "")
    .replace(/\/+$/, "");
}

export function loadConfig(): AppConfig {
  return {
    twitch: {
      clientId: process.env.TWITCH_CLIENT_ID || "",
      clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
      redirectUri: process.env.TWITCH_REDIRECT_URI || "http://localhost:3000/callback",
      channel: normalizeChannelName(process.env.TWITCH_CHANNEL || ""),
    },
    obs: {
      url: process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455",
      password: process.env.OBS_WEBSOCKET_PASSWORD || "",
    },
    dashboard: {
      port: Number(process.env.DASHBOARD_PORT) || 4510,
    },
  };
}
