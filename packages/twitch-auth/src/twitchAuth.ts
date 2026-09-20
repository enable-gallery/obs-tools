import { readFileSync, writeFileSync, existsSync } from "node:fs";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  obtainedAt: number;
  expiresIn: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceCodeInfo {
  verificationUri: string;
  userCode: string;
  expiresInSeconds: number;
}

export type OnDeviceCode = (info: DeviceCodeInfo) => void;

export interface TwitchAuthOptions {
  clientId: string;
  /** Scopes to request during authorization — differs per tool, so there's no default. */
  scopes: string[];
  /** Where access/refresh tokens are persisted between runs. Defaults to ".twitch-tokens.json" in the cwd. */
  tokenFile?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TwitchAuth {
  private readonly clientId: string;
  private readonly scopes: string[];
  private readonly tokenFile: string;
  private tokens: StoredTokens | null = null;

  constructor(options: TwitchAuthOptions) {
    this.clientId = options.clientId;
    this.scopes = options.scopes;
    this.tokenFile = options.tokenFile ?? ".twitch-tokens.json";

    if (existsSync(this.tokenFile)) {
      this.tokens = JSON.parse(readFileSync(this.tokenFile, "utf-8")) as StoredTokens;
    }
  }

  hasTokens(): boolean {
    return this.tokens !== null;
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      await this.authorize();
    } else if (this.isExpiringSoon()) {
      await this.refresh();
    }
    return this.tokens!.accessToken;
  }

  private isExpiringSoon(): boolean {
    if (!this.tokens) return true;
    const expiresAt = this.tokens.obtainedAt + this.tokens.expiresIn * 1000;
    return Date.now() > expiresAt - 5 * 60 * 1000;
  }

  private persist(): void {
    writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
  }

  private storeTokenResponse(data: TokenResponse): void {
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      obtainedAt: Date.now(),
      expiresIn: data.expires_in,
    };
    this.persist();
  }

  private async refresh(): Promise<void> {
    if (!this.tokens) {
      await this.authorize();
      return;
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: this.tokens.refreshToken,
    });

    const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" });
    if (!res.ok) {
      console.warn("[auth] token refresh failed, re-authorizing from scratch");
      this.tokens = null;
      await this.authorize();
      return;
    }

    this.storeTokenResponse((await res.json()) as TokenResponse);
    console.log("[auth] access token refreshed");
  }

  /**
   * Device Code Grant Flow — no client secret, no redirect URI. Requests a
   * short user code + verification URL, then polls until the broadcaster
   * approves it on Twitch's site (or the code expires).
   */
  async authorize(onDeviceCode?: OnDeviceCode): Promise<void> {
    const deviceRes = await fetch("https://id.twitch.tv/oauth2/device", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, scopes: this.scopes.join(" ") }),
    });
    if (!deviceRes.ok) {
      throw new Error(`Failed to start device code flow: ${deviceRes.status} ${await deviceRes.text()}`);
    }
    const device = (await deviceRes.json()) as DeviceCodeResponse;

    console.log(`\n[auth] Go to ${device.verification_uri} and enter code: ${device.user_code}\n`);
    onDeviceCode?.({
      verificationUri: device.verification_uri,
      userCode: device.user_code,
      expiresInSeconds: device.expires_in,
    });

    let intervalSeconds = device.interval || 5;
    const deadline = Date.now() + device.expires_in * 1000;

    while (Date.now() < deadline) {
      await sleep(intervalSeconds * 1000);

      const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      if (tokenRes.ok) {
        this.storeTokenResponse((await tokenRes.json()) as TokenResponse);
        console.log(`[auth] authorization successful, tokens saved to ${this.tokenFile}`);
        return;
      }

      const body = (await tokenRes.json().catch(() => ({}))) as { error?: string; message?: string };
      const errorCode = body.error ?? body.message ?? "";

      if (errorCode.includes("authorization_pending")) {
        continue;
      }
      if (errorCode.includes("slow_down")) {
        intervalSeconds += 5;
        continue;
      }
      throw new Error(`Device code authorization failed: ${errorCode || tokenRes.status}`);
    }

    throw new Error("Device code expired before authorization completed");
  }
}
