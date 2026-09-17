import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASK_RATE_LIMIT_TENANT,
  ASK_RATE_LIMIT_USER,
  ASK_RATE_WINDOW_MS,
  checkAskRateLimit,
} from "./ask-rate-limit";

type Member = { score: number; member: string };

function memoryRedis() {
  const sets = new Map<string, Member[]>();
  return {
    async zremrangebyscore(key: string, min: number, max: number) {
      const rows = (sets.get(key) ?? []).filter((row) => row.score < min || row.score > max);
      sets.set(key, rows);
    },
    async zadd(key: string, item: { score: number; member: string }) {
      const rows = sets.get(key) ?? [];
      rows.push(item);
      sets.set(key, rows);
    },
    async zcard(key: string) {
      return (sets.get(key) ?? []).length;
    },
    async expire() {
      return 1;
    },
  };
}

describe("Ask rate limit", () => {
  it("allows when Redis is not configured", async () => {
    const gate = await checkAskRateLimit({ userId: "user_1", redis: null });
    assert.equal(gate.allowed, true);
  });

  it("caps one user at 10 per minute", async () => {
    const redis = memoryRedis();
    const now = 1_000_000;
    for (let i = 0; i < ASK_RATE_LIMIT_USER; i += 1) {
      const gate = await checkAskRateLimit({ userId: "user_1", nowMs: now + i, redis });
      assert.equal(gate.allowed, true);
    }
    const blocked = await checkAskRateLimit({ userId: "user_1", nowMs: now + 20, redis });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSec, Math.ceil(ASK_RATE_WINDOW_MS / 1000));
    const other = await checkAskRateLimit({ userId: "user_2", nowMs: now, redis });
    assert.equal(other.allowed, true);
  });

  it("caps one tenant at 60 per minute across users", async () => {
    const redis = memoryRedis();
    const now = 2_000_000;
    for (let i = 0; i < ASK_RATE_LIMIT_TENANT; i += 1) {
      const gate = await checkAskRateLimit({
        userId: `user_${i}`,
        tenantId: "org_1",
        nowMs: now + i,
        redis,
      });
      assert.equal(gate.allowed, true);
    }
    const blocked = await checkAskRateLimit({
      userId: "user_new",
      tenantId: "org_1",
      nowMs: now + 100,
      redis,
    });
    assert.equal(blocked.allowed, false);
  });
});
