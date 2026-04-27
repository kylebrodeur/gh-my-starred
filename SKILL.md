---
name: gh-my-starred
description: GitHub CLI extension for browsing starred repositories with AI-accessible JSON output
change_log:
  - timestamp: 2026-04-26T21:55:00Z
    agent_id: "pi-agent"
    note: "Updated pagination logic in fetchStarredRepos to cache all repos and apply limit only to returned results."
---

# gh-my-starred

Browse and query your GitHub starred repositories interactively or programmatically.

## Metadata

- **Source**: https://github.com/kylebrodeur/gh-my-starred
- **NPM**: https://www.npmjs.com/package/pi-gh-my-starred
- **License**: MIT
- **Tags**: `github`, `cli`, `fzf`, `stars`, `repositories`, `search`, `pi-package`, `pi-extension`

## Installation

### Terminal CLI

```bash
gh extension install kylebrodeur/gh-my-starred
```

### PI Package (AI tools)

```bash
pi install npm:pi-gh-my-starred
```

### Both (Recommended)

```bash
gh extension install kylebrodeur/gh-my-starred
pi install npm:pi-gh-my-starred
```

## Usage

### Interactive Mode
```bash
gh my-starred
gh my-starred 100
```

### JSON Mode
```bash
gh my-starred --json
gh my-starred --json 50
```

### Star Lists
```bash
gh my-starred --lists
gh my-starred --list "Favorites"
gh my-starred --list "Research" --json
```

## PI Tools

| Tool | Description |
|------|-------------|
| `starred_repos` | Query and filter starred repositories |
| `list_star_lists` | Discover all star lists |
| `get_list_repos` | Get ordered repos from a specific list |
| `compare_lists` | Compare two star lists |

## Updating

### CLI
```bash
gh extension upgrade kylebrodeur/gh-my-starred
```

### PI Package
```bash
pi update
```

### Both
```bash
gh extension upgrade kylebrodeur/gh-my-starred
pi update
/reload
```

## JSON Schema

| Field | Type | Description |
|-------|------|-------------|
| `full_name` | string | "owner/repo" format |
| `description` | string | Repository description |
| `stargazers_count` | integer | Number of stars |
| `language` | string | Primary language |
| `html_url` | string | Repository URL |
| `topics` | string[] | Topic tags |
| `updated_at` | string | ISO 8601 timestamp |

## Requirements

- GitHub CLI (`gh`) authenticated
- `fzf` for interactive mode
- `jq` recommended for JSON queries

## Uninstall

### CLI
```bash
gh extension remove kylebrodeur/gh-my-starred
```

### PI Package
```bash
pi remove npm:pi-gh-my-starred
```

## Notes

- PI tools (`starred_repos`, etc.) work **standalone** via `gh api`
- `/starred` PI command requires both CLI + PI package installed
- Terminal and PI installs are independent — no conflicts or duplicates
