import type { TwitchAuth } from "./twitchAuth.js";

const HELIX = "https://api.twitch.tv/helix";

/** Authenticated fetch wrapper for Twitch's Helix API — attaches the client ID header and bearer token, and throws on non-2xx responses. */
export class TwitchHelixClient {
  constructor(
    private readonly clientId: string,
    private readonly auth: TwitchAuth
  ) {}

  async call(path: string, init: RequestInit = {}): Promise<Response> {
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
}

export interface TwitchUserIdentity {
  id: string;
  login: string;
  displayName: string;
}

/** Looks up the identity of whoever the current access token belongs to — no login/id needed. */
export async function getAuthorizedUser(helix: TwitchHelixClient): Promise<TwitchUserIdentity> {
  const res = await helix.call(`/users`);
  const data = (await res.json()) as { data: { id: string; login: string; display_name: string }[] };
  const user = data.data[0];
  if (!user) throw new Error("Could not resolve the authorized Twitch user");
  return { id: user.id, login: user.login, displayName: user.display_name };
}

/** Looks up a Twitch user's numeric id from their channel login name. */
export async function getBroadcasterId(helix: TwitchHelixClient, login: string): Promise<string> {
  const res = await helix.call(`/users?login=${encodeURIComponent(login)}`);
  const data = (await res.json()) as { data: { id: string }[] };
  const user = data.data[0];
  if (!user) throw new Error(`No Twitch user found for channel "${login}"`);
  return user.id;
}

export interface TwitchChannelInfo {
  broadcasterId: string;
  broadcasterName: string;
  gameName: string;
  title: string;
}

/** Looks up a channel's current title/category. Works even right as a stream starts, unlike stream-viewer data. No scope required. */
export async function getChannelInfo(helix: TwitchHelixClient, broadcasterId: string): Promise<TwitchChannelInfo> {
  const res = await helix.call(`/channels?broadcaster_id=${broadcasterId}`);
  const data = (await res.json()) as {
    data: { broadcaster_id: string; broadcaster_name: string; game_name: string; title: string }[];
  };
  const info = data.data[0];
  if (!info) throw new Error(`No channel info found for broadcaster id "${broadcasterId}"`);
  return {
    broadcasterId: info.broadcaster_id,
    broadcasterName: info.broadcaster_name,
    gameName: info.game_name,
    title: info.title,
  };
}
