import http from "node:http";
import { URL } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TOKEN_FILE = ".twitch-tokens.json";
const SCOPES = ["channel:read:redemptions", "channel:manage:redemptions"];

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

export class TwitchAuth {
  private tokens: StoredTokens | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string
  ) {
    if (existsSync(TOKEN_FILE)) {
      this.tokens = JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as StoredTokens;
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
    writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2));
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
      client_secret: this.clientSecret,
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

  async authorize(onUrlReady?: (url: string) => void): Promise<void> {
    const redirect = new URL(this.redirectUri);
    const port = Number(redirect.port) || 80;

    const code = await new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", this.redirectUri);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        res.end(error ? `Authorization failed: ${error}` : "Authorization complete, you can close this tab.");
        server.close();

        if (error) reject(new Error(`Twitch authorization error: ${error}`));
        else if (code) resolve(code);
        else reject(new Error("No code or error returned from Twitch"));
      });

      server.listen(port, () => {
        const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
        authorizeUrl.searchParams.set("client_id", this.clientId);
        authorizeUrl.searchParams.set("redirect_uri", this.redirectUri);
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("scope", SCOPES.join(" "));

        console.log("\n[auth] Open this URL as the broadcaster to authorize channel point access:\n");
        console.log(authorizeUrl.toString());
        console.log("\n[auth] Waiting for authorization...\n");
        onUrlReady?.(authorizeUrl.toString());
      });
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });

    const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to exchange authorization code: ${res.status} ${await res.text()}`);
    }

    this.storeTokenResponse((await res.json()) as TokenResponse);
    console.log(`[auth] authorization successful, tokens saved to ${TOKEN_FILE}`);
  }
}
