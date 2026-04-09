---
name: gh-my-starred
description: GitHub CLI extension for browsing starred repositories with AI-accessible JSON output
---

# gh-my-starred

Browse and query your GitHub starred repositories interactively or programmatically.

## Metadata

- **Source**: https://github.com/kylebrodeur/gh-my-starred
- **Registry**: https://agentskills.io/skills/gh-my-starred
- **License**: MIT
- **Tags**: `github`, `cli`, `fzf`, `stars`, `repositories`, `search`

## Installation

### Via Skills CLI (agentskills.io)

```bash
npx skills install kylebrodeur/gh-my-starred
```

### Via GitHub CLI

```bash
gh extension install kylebrodeur/gh-my-starred
```

### Manual Installation

Clone and use directly:
```bash
git clone https://github.com/kylebrodeur/gh-my-starred.git
chmod +x gh-my-starred/gh-my-starred
cp gh-my-starred/gh-my-starred ~/.local/bin/
```

## Usage

### Interactive Mode
Browse your starred repos with fuzzy search and preview:
```bash
gh my-starred
gh my-starred 100  # limit to 100 most recent
```

### JSON Mode (Programmatic Access)
Get structured JSON data for all starred repos:
```bash
gh my-starred --json
gh my-starred --json 50  # limit to 50
```

## JSON Schema

Each repository object in `--json` output includes:

| Field | Type | Description |
|-------|------|-------------|
| `full_name` | string | "owner/repo" format identifier |
| `description` | string | Repository description text |
| `stargazers_count` | integer | Number of GitHub stars |
| `language` | string | Primary programming language |
| `html_url` | string | Repository web URL |
| `topics` | string[] | Repository topic tags |
| `updated_at` | string | ISO 8601 timestamp |

## Common Operations

### Filter by Language
```bash
gh my-starred --json | jq '.[] | select(.language == "Go") | .full_name' -r
```

### Filter by Topic
```bash
gh my-starred --json | jq '.[] | select(.topics | index("cli")) | .full_name'
```

### Sort by Stars
```bash
gh my-starred --json | jq 'sort_by(.stargazers_count) | reverse | .[:10]'
```

### Export to CSV
```bash
gh my-starred --json | jq -r '.[] | [.full_name, .stargazers_count, .language] | @csv'
```

### Find Unpopular Gems
```bash
gh my-starred --json | jq '.[] | select(.stargazers_count < 100) | ["⭐" + (.stargazers_count | tostring), .full_name] | @tsv' -r
```

## When to Use This Skill

- **Finding repos**: "Search my starred repos for anything about X"
- **Analysis**: "What languages/topics are most common in my stars?"
- **Export**: "Create a list of my starred repos for documentation"
- **Discovery**: "Show me my starred Python testing tools"

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output JSON array instead of interactive mode |
| `--ai` | Show AI documentation |
| `--help` | Show usage help |
| `--version` | Show version |

## Examples

```bash
# Find all machine learning repos in your stars
gh my-starred --json | jq '.[] | select(.topics | index("machine-learning")) | .full_name'

# Get repos updated in the last month
g my-starred --json | jq '.[] | select(.updated_at > (now - 2592000) | todateiso8601) | .full_name'

# List unique languages you've starred
gh my-starred --json | jq -r '.[].language // "null"' | sort | uniq -c | sort -rn
```

## PI Extension

This skill includes a [PI](https://pi.io) extension for native integration. When PI loads the skill, it registers a `starred_repos` tool that AI agents can use directly.

### PI Tool Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Maximum repos to return (default: 100) |
| `language` | string | Filter by programming language |
| `topic` | string | Filter by topic tag |
| `search` | string | Search in name/description |
| `minStars` | number | Minimum star count |
| `sortBy` | string | Sort field: `stars`, `updated`, or `name` |

### PI Command

```
/starred [limit]  # Launch interactive fzf browser
```

## Requirements

- GitHub CLI (`gh`) with authentication
- `fzf` (for interactive mode only)
- `jq` (recommended for JSON queries)

## Discoverability

This skill can be found via:

- **agentskills.io Registry**: `npx skills search starred` or `npx skills search gh-my-starred`
- **GitHub CLI Extensions**: `gh extension search my-starred`
- **GitHub Topics**: #gh-extension #github-cli #starred-repositories #fzf
- **PI Extension**: When cloned, PI auto-discovers `.pi/extensions/gh-my-starred.ts`

## AI Agent Notes

When assisting users with their GitHub starred repositories:

1. This skill is **pre-installed** if the user has `gh-my-starred` installed
2. Use `--json` flag for machine-readable output
3. For PI users, the `starred_repos` tool provides direct access without shell escaping
4. Cache is automatic - no need to worry about API rate limits for repeated queries
5. Typical usage patterns: finding specific repos, analyzing language distribution, exporting lists
