/**
 * Ask cost guard: Redis sliding window per Clerk user and optional tenant (org).
 * In-memory limits are not used — Vercel has many instances.
 */

import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const ASK_RATE_WINDOW_MS = 60_000;
export const ASK_RATE_LIMIT_USER = 10;
export const ASK_RATE_LIMIT_TENANT = 60;

type SortedSetRedis = {
  zremrangebyscore: (key: string, min: number, max: number) => Promise<unknown>;
  zadd: (key: string, item: { score: number; member: string }) => Promise<unknown>;
  zcard: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

/**
 * Allow or deny one Ask POST. Skips when Redis is not configured (local/dev).
 * Redis errors fail closed so a broken limiter cannot run unbounded OpenAI spend.
 *
 * @param userId - Clerk user id.
 * @param tenantId - Clerk org id when the session has one.
 * @param redis - Test inject; production uses getRedis().
 */
export async function checkAskRateLimit(opts: {
  userId: string;
  tenantId?: string | null;
  nowMs?: number;
  redis?: SortedSetRedis | null;
}): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const userId = opts.userId.trim();
  if (!userId) return { allowed: false, retryAfterSec: 60 };

  const redis = opts.redis === undefined ? getRedis() : opts.redis;
  if (!redis) return { allowed: true };

  const now = opts.nowMs ?? Date.now();
  try {
    const userHit = await hitWindow(
      redis,
      `ask:rl:user:${userId}`,
      ASK_RATE_LIMIT_USER,
      now
    );
    if (!userHit.allowed) return userHit;
    const tenantId = opts.tenantId?.trim();
    if (!tenantId) return { allowed: true };
    return await hitWindow(redis, `ask:rl:tenant:${tenantId}`, ASK_RATE_LIMIT_TENANT, now);
  } catch (err) {
    logger.error("ask.rate_limit_failed", { kind: err instanceof Error ? err.name : "unknown" });
    return { allowed: false, retryAfterSec: 60 };
  }
}

async function hitWindow(
  redis: SortedSetRedis,
  key: string,
  limit: number,
  now: number
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const cutoff = now - ASK_RATE_WINDOW_MS;
  await redis.zremrangebyscore(key, 0, cutoff);
  await redis.zadd(key, { score: now, member: `${now}:${randomUUID()}` });
  const count = Number(await redis.zcard(key));
  await redis.expire(key, Math.ceil(ASK_RATE_WINDOW_MS / 1000) + 60);
  if (count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil(ASK_RATE_WINDOW_MS / 1000) };
  }
  return { allowed: true };
}
