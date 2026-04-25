#!/usr/bin/env node
/**
 * Edge case tests for gh-my-starred
 */

const lib = require("../src/lib");
const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} — ${e.message}`);
  }
}

console.log("=== Edge Case Tests ===\n");

test("readCache returns null on missing file", () => {
  const result = lib.readCache("/nonexistent/path/file.json");
  assert.strictEqual(result, null);
});

test("readCache returns null on invalid JSON", () => {
  const fs = require("fs");
  const os = require("os");
  const tmp = require("path").join(os.tmpdir(), "gh-test-bad.json");
  fs.writeFileSync(tmp, "not json");
  const result = lib.readCache(tmp);
  assert.strictEqual(result, null);
  fs.unlinkSync(tmp);
});

test("cacheAge returns Infinity on missing file", () => {
  const result = lib.cacheAge("/nonexistent");
  assert.strictEqual(result, Infinity);
});

test("isCacheFresh returns false when cache is stale", () => {
  const fs = require("fs");
  const os = require("os");
  const tmp = require("path").join(os.tmpdir(), "gh-test-stale.json");
  fs.writeFileSync(tmp, "{}");
  const oldTime = new Date(Date.now() - 7200 * 1000);
  fs.utimesSync(tmp, oldTime, oldTime);
  const fresh = lib.isCacheFresh(tmp);
  assert.strictEqual(fresh, false);
  fs.unlinkSync(tmp);
});

test("enrichListRepos handles empty starred cache", () => {
  const result = lib.enrichListRepos(["foo/bar"], null);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]._enriched, false);
});

test("enrichListRepos handles missing repos gracefully", () => {
  const result = lib.enrichListRepos(["foo/bar", "baz/qux"], []);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0]._enriched, false);
  assert.strictEqual(result[1]._enriched, false);
});

test("applyFilters handles empty repos array", () => {
  const result = lib.applyFilters([], { language: "Go" });
  assert.deepStrictEqual(result, []);
});

test("formatRepo handles null description", () => {
  const repo = {
    full_name: "owner/repo",
    stargazers_count: 5,
    language: null,
    description: null,
    topics: [],
    updated_at: "",
    html_url: ""
  };
  const str = lib.formatRepo(repo);
  assert(str.includes("owner/repo"));
  assert(!str.includes("null"));
});

test("sortRepos handles missing updated_at", () => {
  const repos = [
    { full_name: "a", stargazers_count: 1, updated_at: "", description: "", language: null, topics: [], html_url: "" },
    { full_name: "b", stargazers_count: 2, updated_at: null, description: "", language: null, topics: [], html_url: "" }
  ];
  const sorted = lib.sortRepos(repos, "updated");
  assert.strictEqual(sorted.length, 2);
});

test("compareLists handles identical lists", () => {
  const result = lib.compareLists(["a", "b"], ["a", "b"]);
  assert.deepStrictEqual(result.shared, ["a", "b"]);
  assert.deepStrictEqual(result.onlyA, []);
  assert.deepStrictEqual(result.onlyB, []);
});

test("compareLists handles completely different lists", () => {
  const result = lib.compareLists(["a"], ["b"]);
  assert.deepStrictEqual(result.shared, []);
  assert.deepStrictEqual(result.onlyA, ["a"]);
  assert.deepStrictEqual(result.onlyB, ["b"]);
});

test("slugify handles emoji and special chars", () => {
  assert.strictEqual(lib.slugify("My 🌟 List"), "my-🌟-list");
  assert.strictEqual(lib.slugify("C++ Tools"), "c++-tools");
});

test("titleCase handles single word", () => {
  assert.strictEqual(lib.titleCase("favorites"), "Favorites");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
