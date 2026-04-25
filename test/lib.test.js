#!/usr/bin/env node
/**
 * Unit tests for gh-my-starred shared library
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

console.log("=== Testing src/lib.js ===\n");

test("slugify converts spaces to hyphens", () => {
  assert.strictEqual(lib.slugify("My List"), "my-list");
  assert.strictEqual(lib.slugify("Favorites & Tools"), "favorites-&-tools");
});

test("titleCase capitalizes words", () => {
  assert.strictEqual(lib.titleCase("my-list"), "My List");
});

test("enrichListRepos returns enriched data", () => {
  const starred = [
    { full_name: "foo/bar", description: "A repo", stargazers_count: 42, language: "TypeScript", topics: ["cli"], updated_at: "2025-01-01", html_url: "" }
  ];
  const result = lib.enrichListRepos(["foo/bar", "unknown/repo"], starred);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].full_name, "foo/bar");
  assert.strictEqual(result[0].stargazers_count, 42);
  assert.strictEqual(result[1].full_name, "unknown/repo");
  assert.strictEqual(result[1]._enriched, false);
});

test("applyFilters filters by language", () => {
  const repos = [
    { full_name: "a/b", language: "Go", description: "", stargazers_count: 0, topics: [], updated_at: "" },
    { full_name: "c/d", language: "Python", description: "", stargazers_count: 0, topics: [], updated_at: "" }
  ];
  const filtered = lib.applyFilters(repos, { language: "Go" });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].full_name, "a/b");
});

test("applyFilters filters by search", () => {
  const repos = [
    { full_name: "foo/bar", description: "A CLI tool", stargazers_count: 0, language: null, topics: [], updated_at: "" },
    { full_name: "baz/qux", description: "A web app", stargazers_count: 0, language: null, topics: [], updated_at: "" }
  ];
  const filtered = lib.applyFilters(repos, { search: "CLI" });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].full_name, "foo/bar");
});

test("applyFilters filters by minStars", () => {
  const repos = [
    { full_name: "a/b", stargazers_count: 10, language: null, description: "", topics: [], updated_at: "" },
    { full_name: "c/d", stargazers_count: 100, language: null, description: "", topics: [], updated_at: "" }
  ];
  const filtered = lib.applyFilters(repos, { minStars: 50 });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].full_name, "c/d");
});

test("sortRepos sorts by stars desc", () => {
  const repos = [
    { full_name: "a/b", stargazers_count: 10, updated_at: "", description: "", language: null, topics: [], html_url: "" },
    { full_name: "c/d", stargazers_count: 100, updated_at: "", description: "", language: null, topics: [], html_url: "" }
  ];
  const sorted = lib.sortRepos(repos, "stars");
  assert.strictEqual(sorted[0].full_name, "c/d");
});

test("sortRepos sorts by name", () => {
  const repos = [
    { full_name: "z/z", stargazers_count: 0, updated_at: "", description: "", language: null, topics: [], html_url: "" },
    { full_name: "a/a", stargazers_count: 0, updated_at: "", description: "", language: null, topics: [], html_url: "" }
  ];
  const sorted = lib.sortRepos(repos, "name");
  assert.strictEqual(sorted[0].full_name, "a/a");
});

test("compareLists finds shared and unique", () => {
  const result = lib.compareLists(["a", "b", "c"], ["b", "c", "d"]);
  assert.deepStrictEqual(result.shared, ["b", "c"]);
  assert.deepStrictEqual(result.onlyA, ["a"]);
  assert.deepStrictEqual(result.onlyB, ["d"]);
});

test("formatRepo produces expected string", () => {
  const repo = {
    full_name: "owner/repo",
    stargazers_count: 42,
    language: "Go",
    description: "A useful tool",
    topics: [],
    updated_at: "",
    html_url: ""
  };
  const str = lib.formatRepo(repo);
  assert(str.includes("owner/repo"));
  assert(str.includes("42⭐"));
  assert(str.includes("[Go]"));
  assert(str.includes("A useful tool"));
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
