import WebSocket from "ws";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";

export interface RedemptionEvent {
  id: string;
  rewardId: string;
  rewardTitle: string;
  userName: string;
}

export type OnWelcome = (sessionId: string) => Promise<void>;
export type OnRedemption = (event: RedemptionEvent) => Promise<void>;
export type OnConnectionChange = (connected: boolean) => void;

export class EventSubClient {
  private socket: WebSocket | null = null;

  constructor(
    private readonly onWelcome: OnWelcome,
    private readonly onRedemption: OnRedemption,
    private readonly onConnectionChange: OnConnectionChange = () => {}
  ) {}

  connect(url: string = EVENTSUB_URL, isReconnect = false): void {
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on("message", async (raw) => {
      const payload = JSON.parse(raw.toString());
      const type = payload.metadata?.message_type;

      if (type === "session_welcome") {
        const sessionId = payload.payload.session.id;
        console.log(`[eventsub] session ${isReconnect ? "reconnected" : "established"}: ${sessionId}`);
        this.onConnectionChange(true);
        if (!isReconnect) {
          await this.onWelcome(sessionId);
        }
      } else if (type === "session_reconnect") {
        console.log("[eventsub] Twitch requested reconnect");
        this.connect(payload.payload.session.reconnect_url, true);
      } else if (type === "notification") {
        if (payload.metadata.subscription_type === "channel.channel_points_custom_reward_redemption.add") {
          const event = payload.payload.event;
          await this.onRedemption({
            id: event.id,
            rewardId: event.reward.id,
            rewardTitle: event.reward.title,
            userName: event.user_name,
          });
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
        this.onConnectionChange(false);
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
    }
  }
}
