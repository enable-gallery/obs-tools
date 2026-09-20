import WebSocket from "ws";
import type { TwitchHelixClient } from "@obs-tools/twitch-auth";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";

export interface EventSubSubscriptionRequest {
  type: string;
  version: string;
  condition: Record<string, string>;
}

export type EventSubHandler = (event: any) => Promise<void> | void;
export type OnConnectionChange = (connected: boolean) => void;

interface Registration {
  request: EventSubSubscriptionRequest;
  handler: EventSubHandler;
}

/**
 * Generic Twitch EventSub-over-WebSocket client. Unlike a single-topic client,
 * this holds a registry of subscription requests keyed by type, so multiple
 * independent consumers (e.g. reward redemptions and stream online/offline)
 * can share one connection. Several consumers may subscribe to the same
 * (type, condition) pair — each gets its own handler call per notification,
 * but only one remote subscription is created for Twitch to avoid duplicate
 * events and 409s from the EventSub API.
 */
export class TwitchEventSubClient {
  private socket: WebSocket | null = null;
  private readonly registrationsByType = new Map<string, Registration[]>();
  private readonly createdSubscriptionKeys = new Set<string>();
  private readonly connectionHandlers: OnConnectionChange[] = [];
  private sessionId: string | null = null;

  constructor(private readonly helix: TwitchHelixClient) {}

  /** Registers a subscription request + handler. Safe to call before or after connect() — if a session is already established, the subscription is created immediately. Multiple handlers may register for the same (type, condition); each is invoked on every matching notification. */
  subscribe(request: EventSubSubscriptionRequest, handler: EventSubHandler): void {
    const registrations = this.registrationsByType.get(request.type) ?? [];
    registrations.push({ request, handler });
    this.registrationsByType.set(request.type, registrations);
    if (this.sessionId) {
      void this.createSubscriptionIfNeeded(request, this.sessionId);
    }
  }

  onConnectionChange(handler: OnConnectionChange): void {
    this.connectionHandlers.push(handler);
  }

  connect(url: string = EVENTSUB_URL, isReconnect = false): void {
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on("message", async (raw) => {
      const payload = JSON.parse(raw.toString());
      const type = payload.metadata?.message_type;

      if (type === "session_welcome") {
        const sessionId = payload.payload.session.id;
        console.log(`[eventsub] session ${isReconnect ? "reconnected" : "established"}: ${sessionId}`);
        this.sessionId = sessionId;
        this.connectionHandlers.forEach((h) => h(true));
        // Subscriptions carry over automatically across a Twitch-initiated
        // reconnect — only (re-)create them on a fresh session.
        if (!isReconnect) {
          this.createdSubscriptionKeys.clear();
          await this.createSubscriptions(sessionId);
        }
      } else if (type === "session_reconnect") {
        console.log("[eventsub] Twitch requested reconnect");
        this.connect(payload.payload.session.reconnect_url, true);
      } else if (type === "notification") {
        const subscriptionType = payload.metadata.subscription_type;
        const registrations = this.registrationsByType.get(subscriptionType) ?? [];
        for (const registration of registrations) {
          try {
            await registration.handler(payload.payload.event);
          } catch (err) {
            console.error(`[eventsub] handler for ${subscriptionType} threw:`, err);
          }
        }
      } else if (type === "revocation") {
        console.error(
          "[eventsub] subscription revoked:",
          payload.payload?.subscription?.status ?? "unknown reason"
        );
      }
    });

    socket.on("close", (code) => {
      if (this.socket === socket) {
        console.warn(`[eventsub] connection closed unexpectedly (code ${code}), reconnecting in 5s`);
        this.sessionId = null;
        this.connectionHandlers.forEach((h) => h(false));
        setTimeout(() => this.connect(), 5000);
      }
    });

    socket.on("error", (err) => {
      console.error("[eventsub] socket error:", err.message);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners("close");
      this.socket.close();
      this.socket = null;
      this.sessionId = null;
    }
  }

  private async createSubscriptions(sessionId: string): Promise<void> {
    for (const registrations of this.registrationsByType.values()) {
      for (const { request } of registrations) {
        await this.createSubscriptionIfNeeded(request, sessionId);
      }
    }
  }

  private subscriptionKey(request: EventSubSubscriptionRequest): string {
    return `${request.type}:${JSON.stringify(request.condition)}`;
  }

  /** Creates the remote subscription for a (type, condition) pair at most once per session, even if several local handlers registered for it. */
  private async createSubscriptionIfNeeded(request: EventSubSubscriptionRequest, sessionId: string): Promise<void> {
    const key = this.subscriptionKey(request);
    if (this.createdSubscriptionKeys.has(key)) return;
    this.createdSubscriptionKeys.add(key);

    try {
      await this.helix.call(`/eventsub/subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          type: request.type,
          version: request.version,
          condition: request.condition,
          transport: { method: "websocket", session_id: sessionId },
        }),
      });
      console.log(`[eventsub] subscribed to ${request.type}`);
    } catch (err) {
      this.createdSubscriptionKeys.delete(key);
      console.error(`[eventsub] failed to subscribe to ${request.type}:`, err);
    }
  }
}
