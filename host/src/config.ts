import "dotenv/config";

export interface HostEnvConfig {
  twitch: {
    clientId: string;
  };
  obs: {
    url: string;
    password: string;
  };
  discord: {
    botToken: string;
  };
  setupPort: number;
}

export function loadEnvConfig(): HostEnvConfig {
  return {
    twitch: {
      clientId: process.env.TWITCH_CLIENT_ID || "",
    },
    obs: {
      url: process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455",
      password: process.env.OBS_WEBSOCKET_PASSWORD || "",
    },
    discord: {
      botToken: process.env.DISCORD_BOT_TOKEN || "",
    },
    setupPort: Number(process.env.SETUP_PORT) || 4600,
  };
}
