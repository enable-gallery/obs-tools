import { TwitchApi } from "./twitchApi.js";
import type { RewardConfig } from "./config.js";

export async function syncRewards(
  api: TwitchApi,
  broadcasterId: string,
  rewards: RewardConfig[],
  pruneRemoved: boolean
): Promise<Map<string, RewardConfig>> {
  const existing = await api.listManagedRewards(broadcasterId);
  const existingByTitle = new Map(existing.map((r) => [r.title, r]));
  const configuredTitles = new Set(rewards.map((r) => r.title));
  const rewardIdToConfig = new Map<string, RewardConfig>();

  for (const reward of rewards) {
    const current = existingByTitle.get(reward.title);

    if (!current) {
      const created = await api.createReward(broadcasterId, reward);
      console.log(`[rewards] created "${reward.title}" (${created.id})`);
      rewardIdToConfig.set(created.id, reward);
      continue;
    }

    const needsUpdate =
      current.cost !== reward.cost ||
      current.prompt !== (reward.prompt ?? "") ||
      current.global_cooldown_seconds !== (reward.globalCooldownSeconds ?? 0);

    if (needsUpdate) {
      await api.updateReward(broadcasterId, current.id, reward);
      console.log(`[rewards] updated "${reward.title}" (${current.id})`);
    }

    rewardIdToConfig.set(current.id, reward);
  }

  if (pruneRemoved) {
    for (const current of existing) {
      if (!configuredTitles.has(current.title)) {
        await api.deleteReward(broadcasterId, current.id);
        console.log(`[rewards] deleted "${current.title}" (no longer in config)`);
      }
    }
  }

  return rewardIdToConfig;
}
