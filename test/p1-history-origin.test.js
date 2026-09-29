const test = require("node:test");
const assert = require("node:assert/strict");

// Chainable fake of the Supabase query builder: records every call and
// resolves with the configured result for the table/operation.
const calls = [];
let results = {};
function builder(table) {
  const record = { table, ops: [] };
  calls.push(record);
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") {
          const op = record.ops.find((o) => ["select", "delete", "insert", "update"].includes(o.name))?.name || "select";
          const value = results[`${table}:${op}`] || { data: [], error: null, count: 0 };
          return (resolve) => resolve(value);
        }
        return (...args) => {
          record.ops.push({ name: prop, args });
          return proxy;
        };
      },
    }
  );
  return proxy;
}
const supabase = require("../src/services/supabase");
supabase.getSupabaseAdmin = () => ({ from: builder });

const { RESEARCH_HISTORY_FILTER, searchOriginOf, normalizeSearchOrigin } = require("../src/services/searchOrigin");
const { listSearchHistory, clearSearchHistory, deleteSearchHistoryItem } = require("../src/services/researchWorkspace");

test("origin is explicit for new rows and inferred from session_id for legacy rows", () => {
  assert.equal(searchOriginOf({ parsed_query: { _openphysio_origin: "chat" } }), "chat");
  assert.equal(searchOriginOf({ parsed_query: { _openphysio_origin: "research" }, session_id: "x" }), "research");
  // Legacy rows: Chat always sent its conversation id, Research never did.
  assert.equal(searchOriginOf({ parsed_query: {}, session_id: "conv-1" }), "chat");
  assert.equal(searchOriginOf({ parsed_query: {}, session_id: null }), "research");
  assert.equal(searchOriginOf({}), "research");
  assert.equal(normalizeSearchOrigin("anything"), "research");
  assert.match(RESEARCH_HISTORY_FILTER, /_openphysio_origin\.eq\.research/);
  assert.match(RESEARCH_HISTORY_FILTER, /session_id\.is\.null/);
});

test("Research history lists only Research searches", async () => {
  calls.length = 0;
  results = { "research_search_queries:select": { data: [{ id: "q1", query_text: "ejercicio lumbar", parsed_query: {}, created_at: "2026-09-01" }], error: null, count: 1 } };
  const history = await listSearchHistory("user-1", {});
  const query = calls.find((c) => c.table === "research_search_queries");
  assert.ok(query.ops.some((o) => o.name === "or" && o.args[0] === RESEARCH_HISTORY_FILTER));
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].query, "ejercicio lumbar");
});

test("clearing Research history never deletes Chat searches", async () => {
  calls.length = 0;
  results = { "research_search_queries:select": { data: [{ id: "r1" }, { id: "r2" }], error: null } };
  const cleared = await clearSearchHistory("user-1");
  assert.equal(cleared, 2);
  const lookup = calls.find((c) => c.table === "research_search_queries" && c.ops.some((o) => o.name === "select"));
  assert.ok(lookup.ops.some((o) => o.name === "or" && o.args[0] === RESEARCH_HISTORY_FILTER));
  const deletion = calls.find((c) => c.table === "research_search_queries" && c.ops.some((o) => o.name === "delete"));
  assert.ok(deletion.ops.some((o) => o.name === "in" && o.args[0] === "id" && o.args[1].join() === "r1,r2"));
});

test("a Chat search cannot be deleted through the Research history", async () => {
  calls.length = 0;
  results = { "research_search_queries:select": { data: null, error: null } };
  const deleted = await deleteSearchHistoryItem("user-1", "chat-query-id");
  assert.equal(deleted, false);
  const lookup = calls.find((c) => c.table === "research_search_queries");
  assert.ok(lookup.ops.some((o) => o.name === "or" && o.args[0] === RESEARCH_HISTORY_FILTER));
  assert.equal(calls.filter((c) => c.ops.some((o) => o.name === "delete")).length, 0);
});

test("Chat tags its searches as chat; Research keeps the default", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const chat = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  const engine = fs.readFileSync(path.join(__dirname, "../src/services/evidenceSearchEngine.js"), "utf8");
  assert.match(chat, /origin: "chat"/);
  assert.match(engine, /origin = "research"/);
  // Both the initial save and every snapshot update keep the origin.
  assert.equal((engine.match(/\[ORIGIN_KEY\]: normalizeSearchOrigin\(origin\)/g) || []).length, 3);
});
