import { TwitchRewardsClient } from "@obs-tools/twitch-rewards";
import type { SessionLog } from "@obs-tools/session-log";
import type { TwitchContext } from "./types.js";

export interface ChatCommandContext {
  userName: string;
  source: "chat" | "channelPoints";
  /** Words after the command name, for chat-sourced commands. Empty for channel-points commands. */
  args: string[];
  rewardId?: string;
  rewardTitle?: string;
}

export type ChatCommandResult = { ok: true; detail?: string } | { ok: false; reason: string };
export type ChatCommandHandler = (ctx: ChatCommandContext) => Promise<ChatCommandResult> | ChatCommandResult;

export interface ChatController {
  /** Registers a command name (without the "!" prefix) triggered by a typed chat message. */
  registerChatCommand(name: string, handler: ChatCommandHandler): void;
  /** Registers a handler triggered by redeeming a specific channel-points reward. */
  registerRewardCommand(rewardId: string, handler: ChatCommandHandler): void;
}

/** Scopes chat-controller itself needs, beyond whatever a consuming module requires for its own Twitch calls. */
export const REQUIRED_CHAT_SCOPES = ["user:read:chat"];

/**
 * Owns "a command was invoked" — whether from a typed chat message or a
 * channel-points redemption — and routes it to whichever module registered
 * a handler. Modules never talk to EventSub or the redemption-status API
 * directly; they register handlers here instead.
 */
export async function createChatController(twitch: TwitchContext, sessionLog: SessionLog): Promise<ChatController> {
  const { eventSub, clientId, auth, broadcasterId } = twitch;
  const rewardsClient = new TwitchRewardsClient(clientId, auth);

  const chatCommands = new Map<string, ChatCommandHandler>();
  const rewardCommands = new Map<string, ChatCommandHandler>();

  eventSub.subscribe(
    {
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: broadcasterId },
    },
    async (event: any) => {
      const text: string = event.message?.text ?? "";
      if (!text.startsWith("!")) return;

      const [name, ...args] = text.slice(1).trim().split(/\s+/);
      const handler = chatCommands.get(name.toLowerCase());
      if (!handler) return;

      const result = await handler({ userName: event.chatter_user_name, source: "chat", args });
      if (!result.ok) {
        console.warn(`[chat-controller] chat command "${name}" failed: ${result.reason}`);
      }
    }
  );

  eventSub.subscribe(
    {
      type: "channel.channel_points_custom_reward_redemption.add",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId },
    },
    async (event: any) => {
      const rewardId: string = event.reward.id;
      const rewardTitle: string = event.reward.title;
      const userName: string = event.user_name;

      const handler = rewardCommands.get(rewardId);
      if (!handler) return;

      const result = await handler({ userName, source: "channelPoints", args: [], rewardId, rewardTitle });

      try {
        await rewardsClient.updateRedemptionStatus(
          broadcasterId,
          rewardId,
          event.id,
          result.ok ? "FULFILLED" : "CANCELED"
        );
      } catch (err) {
        console.error("[chat-controller] failed to update redemption status:", err);
      }

      if (!result.ok) {
        console.warn(`[chat-controller] "${rewardTitle}" redemption by ${userName} ${result.reason}, refunding`);
      }

      sessionLog.record({
        timestamp: new Date().toISOString(),
        userName,
        rewardTitle,
        kind: "channelPoints",
        detail: result.ok ? (result.detail ?? "") : result.reason,
        status: result.ok ? "FULFILLED" : "CANCELED",
      });
    }
  );

  return {
    registerChatCommand(name: string, handler: ChatCommandHandler): void {
      chatCommands.set(name.toLowerCase(), handler);
    },
    registerRewardCommand(rewardId: string, handler: ChatCommandHandler): void {
      rewardCommands.set(rewardId, handler);
    },
  };
}
