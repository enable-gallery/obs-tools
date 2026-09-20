import type { Client } from "discord.js";
import type { ObsController } from "@obs-tools/obs-client";
import type { TwitchAuth, TwitchHelixClient } from "@obs-tools/twitch-auth";
import type { TwitchEventSubClient } from "@obs-tools/twitch-eventsub";
import type { SessionLog } from "@obs-tools/session-log";
import type { ModuleConfigStore } from "./configStore.js";
import type { ChatController } from "./chatController.js";

export interface ModuleRequirements {
  obs?: boolean;
  twitch?: { scopes: string[] };
  discord?: boolean;
  /** Needs the shared chat-controller (typed chat commands and/or channel-points redemptions). */
  chat?: boolean;
}

export interface TwitchContext {
  clientId: string;
  auth: TwitchAuth;
  helix: TwitchHelixClient;
  eventSub: TwitchEventSubClient;
  /** Broadcaster's channel login, derived from the authorized token. */
  channel: string;
  /** Broadcaster's numeric id, resolved once at connect time. */
  broadcasterId: string;
}

export interface ModuleContext {
  obs?: ObsController;
  twitch?: TwitchContext;
  discord?: Client;
  chat?: ChatController;
  sessionLog: SessionLog;
  config: ModuleConfigStore<any>;
}

export interface ModuleInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Optional manual trigger for a one-off test action (e.g. the setup page's "send test" button). Should throw with a descriptive message on failure. */
  test?(): Promise<void>;
}

export interface ObsToolModule {
  id: string;
  requires: ModuleRequirements;
  init(ctx: ModuleContext): Promise<ModuleInstance>;
}
