import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface RedemptionLogEntry {
  timestamp: string;
  userName: string;
  rewardTitle: string;
  sceneName: string;
  status: "FULFILLED" | "CANCELED";
}

export class SessionLog {
  private readonly filePath: string;
  private readonly entries: RedemptionLogEntry[] = [];

  constructor(sessionsDir: string, startedAt: Date) {
    mkdirSync(sessionsDir, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    this.filePath = path.join(sessionsDir, `session-${stamp}.jsonl`);
  }

  record(entry: RedemptionLogEntry): void {
    this.entries.push(entry);
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
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
