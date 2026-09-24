// Commercial usage allowances (decided 2026-09-24). These are product
// policy, deliberately not read from environment variables: a stale
// CHAT_MONTHLY_LIMIT in a deployment must not silently override them.
//
// One completed Chat question = one chat unit; one completed Research
// search = one research unit, regardless of how many AI calls each needs.
// Chat and Research are independent.
const USAGE_PLANS = Object.freeze({
  paid: Object.freeze({ chat: 200, research: 100 }),
  // Total for the whole trial (5 days on the annual plan), not per month.
  trial: Object.freeze({ chat: 20, research: 10 }),
});

const USAGE_TOOLS = Object.freeze(["chat", "research"]);

module.exports = {
  USAGE_PLANS,
  USAGE_TOOLS,
};
