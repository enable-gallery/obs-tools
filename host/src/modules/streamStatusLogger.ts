import type { ObsToolModule, ModuleContext, ModuleInstance } from "../types.js";

/**
 * Proof-of-concept module for the shared, multi-topic EventSub client:
 * logs stream.online / stream.offline. Deliberately shaped as a direct
 * precursor to a future Discord going-live notifier — same subscriptions,
 * a Discord post instead of a console.log.
 */
export const streamStatusLoggerModule: ObsToolModule = {
  id: "stream-status-logger",
  requires: {
    twitch: { scopes: [] },
  },

  async init(ctx: ModuleContext): Promise<ModuleInstance> {
    if (!ctx.twitch) {
      throw new Error("stream-status-logger requires Twitch to be configured");
    }
    const { eventSub, channel, broadcasterId } = ctx.twitch;

    eventSub.subscribe(
      { type: "stream.online", version: "1", condition: { broadcaster_user_id: broadcasterId } },
      () => {
        console.log(`[stream-status-logger] ${channel} went live`);
        ctx.sessionLog.record({
          timestamp: new Date().toISOString(),
          userName: channel,
          rewardTitle: "Stream Status",
          kind: "stream",
          detail: "online",
          status: "FULFILLED",
        });
      }
    );

    eventSub.subscribe(
      { type: "stream.offline", version: "1", condition: { broadcaster_user_id: broadcasterId } },
      () => {
        console.log(`[stream-status-logger] ${channel} went offline`);
        ctx.sessionLog.record({
          timestamp: new Date().toISOString(),
          userName: channel,
          rewardTitle: "Stream Status",
          kind: "stream",
          detail: "offline",
          status: "FULFILLED",
        });
      }
    );

    return {
      async start(): Promise<void> {
        console.log(`[stream-status-logger] watching ${channel} (broadcaster id ${broadcasterId})`);
      },

      async stop(): Promise<void> {
        // No per-module teardown needed — the host closes the shared EventSub connection.
      },
    };
  },
};
