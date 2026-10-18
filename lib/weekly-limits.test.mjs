import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyLimits } from "./weekly-limits.ts";

const now = 1_800_000_000_000;
const week = 7 * 24 * 60 * 60 * 1000;
const limit = (id, window, amount = { unit: "percent", used: 20 }) => ({
  id, label: id, scope: { provider: "openai-codex" }, window, amount,
});
const report = (limits, metadata = { email: "one@example.com" }) => ({
  provider: "openai-codex", fetchedAt: now, limits, metadata,
});
const project = (reports, accounts = []) => buildWeeklyLimits(reports, accounts, (provider) => provider !== "local", now);

test("only weekly windows are shown, including scoped weekly caps, never an arbitrary secondary window", () => {
  const result = project([report([
    limit("five-hour", { id: "5h", durationMs: 5 * 60 * 60 * 1000 }),
    limit("secondary", { id: "secondary", durationMs: 24 * 60 * 60 * 1000 }),
    limit("weekly", { id: "secondary", durationMs: week }),
    limit("scoped", { id: "7d" }),
    limit("monthly", { id: "monthly" }),
    limit("contradictory", { id: "7d", durationMs: 24 * 60 * 60 * 1000 }),
  ])]);
  assert.deepEqual(result.accounts[0].limits.map((value) => value.id), ["weekly", "scoped"]);
});

test("remaining percentages preserve zero, clamp overage, and leave unknown usage unknown", () => {
  const amounts = [
    { unit: "percent", used: 100 },
    { unit: "percent", used: 0 },
    { unit: "percent", usedFraction: 1.2 },
    { unit: "requests", used: 30, limit: 40 },
    { unit: "percent", remainingFraction: 0.5 },
    { unit: "unknown" },
    { unit: "percent", usedFraction: NaN },
  ];
  const result = project([report(amounts.map((amount, index) => limit(String(index), { id: "7d" }, amount)))]);
  assert.deepEqual(result.accounts[0].limits.map((value) => value.remainingPercent), [0, 100, 0, 25, 50, null, null]);
});

test("a snapshot from before a reset cannot claim current remaining quota", () => {
  const result = project([{ ...report([limit("weekly", { id: "7d", resetsAt: now - 1000 })]), fetchedAt: now - 2000 }]);
  assert.equal(result.accounts[0].limits[0].remainingPercent, null);
  assert.equal(result.accounts[0].limits[0].resetsAt, now - 1000);
});

test("accounts sharing a workspace remain separate and a failed sibling stays visible", () => {
  const accounts = ["one@example.com", "two@example.com"].map((email) => ({
    provider: "openai-codex", type: "oauth", email, accountId: "workspace",
  }));
  const result = project([report([limit("weekly", { id: "7d" })], {
    email: accounts[0].email, accountId: "workspace",
  })], accounts);
  assert.deepEqual(result.accounts.map((account) => [account.label, account.status]), [
    ["one@example.com", "ready"], ["two@example.com", "unavailable"],
  ]);
});

test("same-email subscriptions retain their organization identity", () => {
  const accounts = ["org-a", "org-b"].map((orgId) => ({
    provider: "anthropic", type: "oauth", email: "one@example.com", orgId,
  }));
  const result = project([{
    ...report([limit("weekly", { id: "7d" })], { email: "one@example.com", orgId: "org-a" }),
    provider: "anthropic",
  }], accounts);
  assert.deepEqual(result.accounts.map((account) => [account.label, account.status]), [
    ["one@example.com · org-a", "ready"], ["one@example.com · org-b", "unavailable"],
  ]);
});

test("unsupported accounts and failed fetches are distinguished without inventing a limit", () => {
  const result = project([report([limit("daily", { id: "1d" })])], [
    { provider: "local", type: "api_key" },
    { provider: "anthropic", type: "oauth", email: "two@example.com" },
  ]);
  assert.deepEqual(result.accounts.map((account) => [account.status, account.limits]), [
    ["unsupported", []], ["unsupported", []], ["unavailable", []],
  ]);
});

test("API output never includes raw provider payloads or arbitrary metadata", () => {
  const result = project([{
    ...report([limit("weekly", { id: "7d" })], { email: "one@example.com", accessToken: "secret-token" }),
    raw: { authorization: "secret-token" },
  }]);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
  assert.equal(result.accounts[0].label, "one@example.com");
});
