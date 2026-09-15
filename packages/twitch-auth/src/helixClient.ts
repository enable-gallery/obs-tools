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
