const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getCurrentMonthKey,
  formatQuota,
} = require("../src/services/chatQuota");

test("formats the UTC month key", () => {
  assert.equal(
    getCurrentMonthKey(new Date("2026-07-05T23:30:00Z")),
    "2026-07"
  );
});

test("formats quota values and remaining questions", () => {
  assert.deepEqual(
    formatQuota({
      used_count: 12,
      limit_count: 130,
      month_key: "2026-07",
    }),
    {
      used: 12,
      limit: 130,
      remaining: 118,
      monthKey: "2026-07",
    }
  );
});

test("never returns a negative remaining quota", () => {
  assert.equal(
    formatQuota({ used_count: 140, limit_count: 130 }).remaining,
    0
  );
});
