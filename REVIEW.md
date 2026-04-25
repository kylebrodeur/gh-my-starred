# gh-my-starred Review & Enhancement Plan

> **Status (2026-04-25):** Phase 1 & 2 implementation complete. PI extension imports fixed, star list support added, Node.js CLI replaces bash, shared library extracted, tests passing.

## Executive Summary

`gh-my-starred` is a GitHub CLI extension + PI extension for browsing starred repositories. It has solid foundations but had several gaps in PI extension API compatibility, missing star list support, and architectural limitations.

**Phase 1** fixed critical issues and added star list support to both CLI and PI extension.
**Phase 2** rewrote the CLI in Node.js with a shared library, added unit tests, and established a monorepo structure.

---

## Completed Changes

### ✅ Phase 1 (Done)

1. **Fixed PI extension imports**: Changed `@sinclair/typebox` → `typebox` in `.pi/extensions/gh-my-starred.ts`
2. **Added `package.json`** to `.pi/extensions/` with correct dependency declaration
3. **Added star list discovery** to bash CLI (`--lists` flag)
4. **Added star list browsing** to bash CLI (`--list "Name"` flag, `--list-refresh` flag)
5. **Rewrote PI extension** with 4 tools:
   - `starred_repos` — query and filter starred repos (enhanced)
   - `list_star_lists` — discover all star lists
   - `get_list_repos` — get ordered repos from a specific list (cross-references with starred cache)
   - `compare_lists` — compare two lists for shared/unique repos
6. **Fixed Ctrl-R reload binding** in bash script (removed non-executable `get_names_data` fallback)
7. **Added list-specific caching** at `~/.cache/gh-my-starred/lists/`
8. **Updated all documentation**: README.md, SKILL.md, .claude/skills, .github/skills
9. **Updated tests**: run.sh and test.bats

### ✅ Phase 2 (Done)

1. **Rewrote CLI in Node.js**:
   - `src/cli.js` — main CLI entry point (replaces all bash logic)
   - `src/lib.js` — shared library for cache, GitHub API, scraping, filtering
   - `gh-my-starred` — thin bash wrapper that calls `node src/cli.js`
2. **Shared library features**:
   - Cache management (starred repos + lists, TTL, file permissions)
   - GitHub API helpers (`execGh`, `execCurl`)
   - Star list discovery (GraphQL → HTML scraping fallback)
   - Ordered list scraping with polite delays (`DELAY_MS = 500`)
   - Cross-reference enrichment (list order + starred metadata)
   - Filtering and sorting
   - List comparison
3. **Unit tests**: `test/lib.test.js` with 10 tests (all passing)
4. **Integration tests**: `test/run.sh` with 13 tests (all passing)
5. **Root `package.json`** with scripts: `test`, `test:unit`, `test:integration`, `lint`, `cli`
6. **Updated `test/test.bats`** for bats compatibility

---

## Architecture

```
gh-my-starred/
├── gh-my-starred              # Bash wrapper (backward compat with gh extensions)
├── package.json               # Root package metadata + scripts
├── src/
│   ├── cli.js                 # Node.js CLI (interactive + JSON + lists)
│   └── lib.js                 # Shared library (cache, API, scraper, filters)
├── .pi/
│   └── extensions/
│       ├── package.json       # PI extension deps
│       └── gh-my-starred.ts   # PI extension (4 tools, 1 command)
├── test/
│   ├── run.sh                 # Integration test suite (13 tests)
│   ├── test.bats              # bats-compatible test suite
│   └── lib.test.js            # Unit test suite (10 tests)
├── README.md, SKILL.md, LICENSE
└── .claude/skills/, .github/skills/  # AI agent skill files
```

---

## Remaining Items

### 🔄 Phase 3 (Future)

- [ ] Publish to npm as `@kylebrodeur/gh-my-starred`
- [ ] CI workflow to run tests on push/PR
- [ ] Add more unit tests for edge cases (empty lists, API errors, rate limits)
- [ ] Consider rewriting PI extension to import from `src/lib.js` (needs jiti verification)
- [ ] Add JSDoc types for better IDE support in `src/lib.js`

---

## Original Review (for reference)

### Critical Issues Found (now fixed)

1. **PI Extension Import Mismatch**: Used `@sinclair/typebox` but PI 0.70.2 bundles `typebox`. Fixed.
2. **No Star List API**: GitHub's API doesn't expose list ordering. Solved with HTML scraping + cross-referencing.
3. **Bash Script Limitations**: Hard to extend, broken fzf reload, tight coupling. Replaced with Node.js CLI.

### Data Flow for Star Lists

```
HTML scrape (web UI)  →  ordered list of full_names
         ↓
Full starred API      →  metadata cache
         ↓
    Cross-reference   →  ordered, enriched results
```

### Security

- Cache files written with `0o600` permissions
- Polite scraping delays (500ms between pages)
- No auth tokens exposed in logs
- Shell commands use `JSON.stringify()` for argument escaping
