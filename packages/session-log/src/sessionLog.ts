import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface SessionLogEntry {
  timestamp: string;
  userName: string;
  rewardTitle: string;
  kind: string;
  detail: string;
  status: "FULFILLED" | "CANCELED";
}

export type SessionLogHandler = (entry: SessionLogEntry) => void;

export class SessionLog {
  private readonly filePath: string;
  private readonly entries: SessionLogEntry[] = [];
  private readonly handlers: SessionLogHandler[] = [];

  constructor(sessionsDir: string, startedAt: Date) {
    mkdirSync(sessionsDir, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    this.filePath = path.join(sessionsDir, `session-${stamp}.jsonl`);
  }

  record(entry: SessionLogEntry): void {
    this.entries.push(entry);
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
    this.handlers.forEach((h) => h(entry));
  }

  /** Notified with every entry as it's recorded — e.g. to mirror it to a live-updating UI. */
  onRecord(handler: SessionLogHandler): void {
    this.handlers.push(handler);
  }

  printSummary(): void {
    if (this.entries.length === 0) {
      console.log("[session] no redemptions this session");
      return;
    }

    const byUser = new Map<string, number>();
    for (const entry of this.entries) {
      byUser.set(entry.userName, (byUser.get(entry.userName) ?? 0) + 1);
    }

    const ranked = [...byUser.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\n[session] ${this.entries.length} redemption(s) from ${byUser.size} viewer(s):`);
    for (const [userName, count] of ranked) {
      console.log(`  - ${userName}: ${count}`);
    }
    console.log(`[session] full log saved to ${this.filePath}`);
  }
}
