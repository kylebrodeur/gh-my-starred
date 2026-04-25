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

### Via GitHub CLI (for terminal use)

```bash
gh extension install kylebrodeur/gh-my-starred
```

This provides the `gh my-starred` command in your terminal.

### Via PI (for AI agent tools)

```bash
pi install npm:pi-gh-my-starred
```

Or via git:

```bash
pi install git:github.com/kylebrodeur/gh-my-starred@v0.2.0
```

This provides AI tools (`starred_repos`, `list_star_lists`, etc.) that AI agents can use.

### Both (Recommended)

For the full experience (terminal CLI + AI tools + interactive `/starred` command):

```bash
gh extension install kylebrodeur/gh-my-starred
pi install git:github.com/kylebrodeur/gh-my-starred@v0.2.0
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

### Star Lists
Discover and browse curated star lists (preserves ordering):
```bash
gh my-starred --lists                       # Show all lists
gh my-starred --list "Favorites"            # Browse a list
gh my-starred --list "Research" --json      # Export list as JSON
gh my-starred --list "Research" --json 20   # Limit to 20
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
| `--lists` | Show all star lists |
| `--list NAME` | Browse a specific star list |
| `--list-refresh` | Force refresh list cache |
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

This skill includes a [PI](https://pi.io) extension for native integration. When PI loads the skill, it registers these tools:

### PI Tools

| Tool | Description |
|------|-------------|
| `starred_repos` | Query and filter all starred repositories |
| `list_star_lists` | Discover all star lists |
| `get_list_repos` | Get ordered repos from a specific list |
| `compare_lists` | Compare two star lists |

### PI Tool Parameters: `starred_repos`

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Maximum repos to return (default: 100) |
| `language` | string | Filter by programming language |
| `topic` | string | Filter by topic tag |
| `search` | string | Search in name/description |
| `minStars` | number | Minimum star count |
| `sortBy` | string | Sort field: `stars`, `updated`, `name`, `starred_at` |
| `refresh` | boolean | Force refresh cache |

### PI Tool Parameters: `get_list_repos`

| Parameter | Type | Description |
|-----------|------|-------------|
| `listName` | string | Name of the star list (required) |
| `limit` | number | Maximum repos to return |
| `refresh` | boolean | Force refresh list cache |
| `language` | string | Filter by programming language |
| `topic` | string | Filter by topic tag |
| `search` | string | Search in name/description |
| `minStars` | number | Minimum star count |
| `enrich` | boolean | Enrich with starred cache metadata (default: true) |

### PI Command

```
/starred                    # Launch interactive fzf browser
/starred 50                 # Limit to 50 repos
/starred list "Favorites"   # Browse a specific list
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
