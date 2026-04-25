# gh-my-starred Review & Enhancement Plan

> **Status (2026-04-25):** Implementation complete. All phases done. 35/35 tests passing.

## Executive Summary

`gh-my-starred` is a GitHub CLI extension + PI extension for browsing starred repositories. It now supports **star lists with preserved ordering**, a **Node.js CLI**, and **PI package** distribution.

---

## Completed Changes

### ✅ Phase 1
- Fixed PI extension imports (`@sinclair/typebox` → `typebox`)
- Added `--lists` and `--list "Name"` flags to bash CLI
- 4 PI tools: `starred_repos`, `list_star_lists`, `get_list_repos`, `compare_lists`
- Fixed fzf Ctrl-R reload binding
- List-specific caching at `~/.cache/gh-my-starred/lists/`

### ✅ Phase 2
- Replaced bash CLI with Node.js (`src/cli.js` + `src/lib.js`)
- Shared library: cache, API, scraping, filtering, comparison
- Unit tests: 10 tests for `src/lib.js`
- Integration tests: 12 tests in `test/run.sh`
- Root `package.json` as a **pi package** (`"pi": { "extensions": [...] }`)

### ✅ Phase 3
- **Edge case fixes**:
  - curl `-f` flag for HTTP error detection + retry with exponential backoff
  - 404 detection on first page of list scraping
  - Configurable timeout via `GH_STARRED_TIMEOUT`
  - Cache resilience (invalid JSON → null)
  - fzf exit code checking
  - Browser open wrapped in try/catch
- **13 edge-case unit tests** (all passing)

### Test Results
```
35/35 passing (12 integration + 10 lib + 13 edge-case)
```

---

## Architecture

```
gh-my-starred/
├── gh-my-starred              # Bash wrapper → delegates to src/cli.js
├── package.json               # Root package + pi config
├── src/
│   ├── cli.js                 # Node.js CLI
│   └── lib.js                 # Shared library
├── .pi/
│   └── extensions/
│       └── gh-my-starred.ts   # PI extension (4 tools)
├── test/
│   ├── run.sh                 # Integration tests (12)
│   ├── lib.test.js            # Unit tests (10)
│   └── edge-cases.test.js     # Edge case tests (13)
└── README.md, SKILL.md, LICENSE
```

---

## Usage

### CLI
```bash
gh my-starred --json                    # All starred repos
gh my-starred --lists                   # Discover star lists
gh my-starred --list "Favorites"       # Ordered repos from a list
gh my-starred --list "Research" --json # Export list as JSON
```

### PI Tools
```
starred_repos — query/filter starred repos
list_star_lists — discover lists
get_list_repos — ordered repos from a list
compare_lists — compare two lists
```

### Environment
```bash
GH_STARRED_CACHE_TTL=3600      # Cache TTL in seconds
GH_STARRED_TIMEOUT=120000      # API timeout in ms
```

---

## Open Questions

1. Does GraphQL `user.lists` work reliably? (Extension tries it first, falls back to scraping)
2. Should we support creating/editing star lists, or is read-only sufficient?
3. What's the practical rate limit for GitHub web UI scraping?
