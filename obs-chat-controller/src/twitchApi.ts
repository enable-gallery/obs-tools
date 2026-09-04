import { TwitchAuth } from "./twitchAuth.js";
import type { RewardConfig } from "./config.js";

const HELIX = "https://api.twitch.tv/helix";

export interface TwitchReward {
  id: string;
  title: string;
  cost: number;
  prompt: string;
  is_global_cooldown_enabled: boolean;
  global_cooldown_seconds: number;
  background_color: string;
}

export class TwitchApi {
  constructor(
    private readonly clientId: string,
    private readonly auth: TwitchAuth
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.auth.getAccessToken();
    const res = await fetch(`${HELIX}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        "Client-Id": this.clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twitch API ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
    }

    return res;
  }

  async getBroadcasterId(login: string): Promise<string> {
    const res = await this.call(`/users?login=${encodeURIComponent(login)}`);
    const data = (await res.json()) as { data: { id: string }[] };
    const user = data.data[0];
    if (!user) throw new Error(`No Twitch user found for channel "${login}"`);
    return user.id;
  }

  async listManagedRewards(broadcasterId: string): Promise<TwitchReward[]> {
    const res = await this.call(
      `/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&only_manageable_rewards=true`
    );
    const data = (await res.json()) as { data: TwitchReward[] };
    return data.data;
  }

  async createReward(broadcasterId: string, reward: RewardConfig): Promise<TwitchReward> {
    const res = await this.call(`/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, {
      method: "POST",
      body: JSON.stringify(this.toApiBody(reward)),
    });
    const data = (await res.json()) as { data: TwitchReward[] };
    return data.data[0];
  }

  async updateReward(broadcasterId: string, rewardId: string, reward: RewardConfig): Promise<TwitchReward> {
    const res = await this.call(
      `/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
      { method: "PATCH", body: JSON.stringify(this.toApiBody(reward)) }
    );
    const data = (await res.json()) as { data: TwitchReward[] };
    return data.data[0];
  }

  async deleteReward(broadcasterId: string, rewardId: string): Promise<void> {
    await this.call(`/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`, {
      method: "DELETE",
    });
  }

  async updateRedemptionStatus(
    broadcasterId: string,
    rewardId: string,
    redemptionId: string,
    status: "FULFILLED" | "CANCELED"
  ): Promise<void> {
    await this.call(
      `/channel_points/custom_rewards/redemptions?broadcaster_id=${broadcasterId}&reward_id=${rewardId}&id=${redemptionId}`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
  }

  async createEventSubSubscription(broadcasterId: string, sessionId: string): Promise<void> {
    await this.call(`/eventsub/subscriptions`, {
      method: "POST",
      body: JSON.stringify({
        type: "channel.channel_points_custom_reward_redemption.add",
        version: "1",
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: "websocket", session_id: sessionId },
      }),
    });
  }

  private toApiBody(reward: RewardConfig) {
    return {
      title: reward.title,
      prompt: reward.prompt ?? "",
      cost: reward.cost,
      is_enabled: true,
      background_color: reward.backgroundColor,
      is_global_cooldown_enabled: Boolean(reward.globalCooldownSeconds),
      global_cooldown_seconds: reward.globalCooldownSeconds,
      should_redemptions_skip_request_queue: false,
    };
  }
}
