import { getChannelInfo } from "@obs-tools/twitch-auth";
import type { ObsToolModule, ModuleContext, ModuleInstance } from "../types.js";

export interface DiscordNotifyConfig {
  channelId: string;
  messageTemplate: string;
}

export const DEFAULT_CONFIG: DiscordNotifyConfig = {
  channelId: "",
  messageTemplate: "🔴 **{channel}** is live: {title} — playing {game}\n{url}",
};

function renderMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template
  );
}

/**
 * Posts a going-live announcement to Discord. A direct sibling of the
 * stream-status-logger module: same stream.online subscription, a Discord
 * post instead of a console.log.
 */
export const discordNotifyModule: ObsToolModule = {
  id: "discord-notify",
  requires: {
    twitch: { scopes: [] },
    discord: true,
  },

  async init(ctx: ModuleContext): Promise<ModuleInstance> {
    if (!ctx.twitch) throw new Error("discord-notify requires Twitch to be configured");
    if (!ctx.discord) throw new Error("discord-notify requires Discord to be configured");

    const { helix, eventSub, channel, broadcasterId } = ctx.twitch;
    const discord = ctx.discord;

    // Shared by the real stream.online handler and the setup page's manual
    // test button, so a test post exercises the exact same path (config,
    // Helix lookup, Discord send) as a real going-live post.
    async function postGoingLiveMessage(isTest: boolean): Promise<void> {
      // Re-read on every call (rather than once at init) so a channel ID or
      // template saved from the setup page afterward takes effect without
      // restarting the host.
      const stored = ctx.config.read() as Partial<DiscordNotifyConfig>;
      const config: DiscordNotifyConfig = { ...DEFAULT_CONFIG, ...stored };

      if (!config.channelId) {
        throw new Error(
          'no Discord channel configured — set it on the setup page or under moduleConfig["discord-notify"].channelId in host/config.json'
        );
      }

      const info = await getChannelInfo(helix, broadcasterId);
      let message = renderMessage(config.messageTemplate, {
        channel: info.broadcasterName,
        title: info.title || "(no title set)",
        game: info.gameName || "nothing",
        url: `https://twitch.tv/${channel}`,
      });
      if (isTest) message = `🧪 **TEST — not a real going-live post**\n${message}`;

      const discordChannel = await discord.channels.fetch(config.channelId);
      if (!discordChannel?.isSendable()) {
        throw new Error(`Discord channel ${config.channelId} was not found or isn't sendable`);
      }

      await discordChannel.send(message);
      console.log(`[discord-notify] posted ${isTest ? "test " : ""}going-live message to Discord channel ${config.channelId}`);
    }

    eventSub.subscribe(
      { type: "stream.online", version: "1", condition: { broadcaster_user_id: broadcasterId } },
      async () => {
        try {
          await postGoingLiveMessage(false);
        } catch (err) {
          console.error("[discord-notify] failed to post going-live message:", err);
        }
      }
    );

    return {
      async start(): Promise<void> {
        console.log(`[discord-notify] watching ${channel} for stream.online`);
      },
      async stop(): Promise<void> {
        // No per-module teardown needed — the host closes the shared Twitch/Discord connections.
      },
      async test(): Promise<void> {
        await postGoingLiveMessage(true);
      },
    };
  },
};
