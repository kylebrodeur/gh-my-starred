# gh-my-starred

[![GitHub CLI](https://img.shields.io/badge/github--cli-extension-brightgreen?logo=github)](https://cli.github.com/)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/kylebrodeur/gh-my-starred/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A [GitHub CLI](https://cli.github.com/) extension to interactively browse your starred repositories.

## Features

- **Fuzzy search** through all your starred repos with `fzf`
- **JSON output** for scripting and analysis with `jq`
- **Smart caching** for users with 1000+ stars (auto-detects updates)
- **Star lists** support — browse curated lists with preserved ordering
- **PI extension** with native AI agent support (`starred_repos`, `list_star_lists`, `get_list_repos` tools)
- **One-key open** in browser
- **Filter by** language, topic, or search query

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Usage](#usage)
- [Caching](#caching-for-1000-stars)
- [Star Lists](#star-lists)
- [PI Extension](#pi-extension)
- [JSON Examples](#json-examples)
- [Discoverability](#discoverability)
- [Updating](#updating)
- [Uninstall](#uninstall)
- [License](#license)

## Installation

### Via GitHub CLI (gh)

```bash
gh extension install kylebrodeur/gh-my-starred
```

### Via Skills CLI (npx skills)

```bash
npx skills install kylebrodeur/gh-my-starred
```

This installs the skill to the appropriate location for your AI agent (Claude Code, Copilot, PI, etc.) based on the agentskills.io standard.

### Manual Installation

```bash
# Clone
git clone https://github.com/kylebrodeur/gh-my-starred.git

# Make executable
chmod +x gh-my-starred/gh-my-starred

# Link to PATH or use directly
ln -s "$PWD/gh-my-starred/gh-my-starred" ~/.local/bin/
```

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) - authenticated
- [fzf](https://github.com/junegunn/fzf) - Only required for interactive mode
- [jq](https://stedolan.github.io/jq/) - Recommended for JSON parsing

## Usage

```bash
gh my-starred [options] [limit]
```

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |
| `-j, --json` | Output as JSON array (pipeable, no interactive mode) |
| `--ai` | Show AI assistant documentation |
| `--cache` | Force use cached data |
| `--refresh` | Force refresh cache |
| `--lists` | Show all star lists |
| `--list NAME` | Browse a specific star list (preserves order) |
| `--list-refresh` | Force refresh list cache |

### Arguments

| Argument | Description |
|----------|-------------|
| `limit` | Maximum number of repositories to fetch (default: all) |

### Examples

```bash
# Interactive mode
gh my-starred              # Browse all starred repos
gh my-starred 100          # Browse last 100 starred repos

# JSON output mode (scriptable)
gh my-starred --json       # Output full JSON of all starred repos
gh my-starred --json 50    # Output JSON of last 50 starred repos

# Documentation
gh my-starred --ai         # Show AI assistant documentation
gh my-starred --help       # Show usage help
```

### JSON Schema

When using `--json`, each repository object includes:

```json
{
  "full_name": "owner/repo",
  "description": "Repository description",
  "stargazers_count": 123,
  "language": "Python",
  "html_url": "https://github.com/owner/repo",
  "topics": ["cli", "automation"],
  "updated_at": "2025-01-15T10:30:00Z",
  ...
}
```

### JSON Examples

```bash
# Filter repos by language
gh my-starred --json | jq -r '.[] | select(.language == "Go") | .full_name'

# Find repos by topic
gh my-starred --json | jq -r '.[] | select(.topics | index("machine-learning")) | .full_name'

# Get top 10 starred repos
gh my-starred --json | jq 'sort_by(.stargazers_count) | reverse | .[:10]'

# Export to CSV
g my-starred --json | jq -r '.[] | [.full_name, .stargazers_count, .language] | @csv' > starred.csv

# Star lists
gh my-starred --lists                    # Show all star lists
gh my-starred --list "Favorites"        # Browse a list interactively
gh my-starred --list "Favorites" --json # Output list as JSON
```

## Interactive Mode

### Keys

| Key | Action |
|-----|--------|
| `↑/↓` | Navigate |
| `Enter` | Open selected repo in browser |
| `Ctrl-C` | Exit |

## Caching for 1000+ Stars

With many starred repos, fetching can be slow. gh-my-starred automatically caches and smartly updates:

| Feature | Description |
|---------|-------------|
| **Cache Location** | `~/.cache/gh-my-starred/starred-repos.json` (respects `XDG_CACHE_HOME`) |
| **Smart Updates** | Compares `starred_at` timestamp - only fetches if new stars exist |
| **Default TTL** | 1 hour (3600 seconds) |
| **Custom TTL** | Set `GH_STARRED_CACHE_TTL` environment variable |

```bash
# Force cache refresh
gh my-starred --refresh

# Cache for 24 hours
export GH_STARRED_CACHE_TTL=86400
gh my-starred
```

## Star Lists

GitHub Star Lists allow you to organize starred repos into curated collections. Since GitHub's API does not expose list ordering, gh-my-starred uses HTML scraping to preserve the order in which repos were added to each list.

### Discover lists

```bash
gh my-starred --lists
```

### Browse a specific list (ordered)

```bash
gh my-starred --list "Favorites"
gh my-starred --list "Research" --json
gh my-starred --list "Research" --json 20
```

### List caching

List contents are cached separately at `~/.cache/gh-my-starred/lists/`. Use `--list-refresh` to force a refresh:

```bash
gh my-starred --list "Favorites" --list-refresh --json
```

## PI Extension

This repository includes a native [PI](https://github.com/marioechler/pi) extension.

### Installation

Copy or symlink the extension to your PI extensions directory:

```bash
# Global installation (recommended)
mkdir -p ~/.pi/agent/extensions/
cp .pi/extensions/gh-my-starred.ts ~/.pi/agent/extensions/

# Or project-local
mkdir -p .pi/extensions/
ln -s .pi/extensions/gh-my-starred.ts ../.pi/extensions/
```

Then reload PI with `/reload`.

### PI Tools

Once installed, AI agents in PI can use these tools:

| Tool | Description |
|------|-------------|
| `starred_repos` | Query and filter all starred repositories |
| `list_star_lists` | Discover all star lists for the user |
| `get_list_repos` | Get ordered repos from a specific star list |
| `compare_lists` | Compare two star lists (shared, unique) |

#### `starred_repos` Parameters

| Parameter | Description |
|-----------|-------------|
| `limit` | Max repos to return (default: 100, max: 500) |
| `language` | Filter by programming language |
| `topic` | Filter by topic tag |
| `search` | Fuzzy search in name/description |
| `minStars` | Minimum stargazer count |
| `sortBy` | Sort by: `stars`, `updated`, `name`, or `starred_at` |
| `refresh` | Force refresh cache before querying |

#### `get_list_repos` Parameters

| Parameter | Description |
|-----------|-------------|
| `listName` | Name of the star list (required) |
| `limit` | Max repos to return |
| `refresh` | Force refresh list cache |
| `language` | Filter by programming language |
| `topic` | Filter by topic tag |
| `search` | Search in name or description |
| `minStars` | Minimum stargazer count |
| `enrich` | Enrich with full metadata from starred cache (default: true) |

### PI Command: `/starred`

Open the interactive fzf browser from within PI:
```
/starred           # Browse starred repos
/starred 50        # Limit to 50 repos
/starred list "Favorites"  # Browse a specific list
```

### PI Command: `/starred`

Open the interactive fzf browser from within PI:
```
/starred      # Browse starred repos
/starred 50   # Limit to 50 repos
```

## AI Assistant Support

This extension includes built-in documentation for AI assistants. Run:

```bash
gh my-starred --ai
```

This prints guidance for AI agents on how to programatically interact with the extension.

## Discoverability

This extension is listed in multiple registries:

- **GitHub CLI Extensions**: `gh extension install kylebrodeur/gh-my-starred`
- **npx skills**: `npx skills install kylebrodeur/gh-my-starred`
- **Claude Code**: Auto-discovers `.claude/skills/gh-my-starred/SKILL.md`
- **GitHub Copilot**: Auto-discovers `.github/skills/gh-my-starred/SKILL.md`
- **PI Extensions**: Auto-discovers `.pi/extensions/gh-my-starred.ts`
- **GitHub Topics**: `gh-extension`, `github-cli`, `fzf`, `starred-repositories`

### For AI Agents

AI assistants can discover this tool via:

1. **npx skills** - Installs via `npx skills install kylebrodeur/gh-my-starred`
2. **SKILL.md (root)** - Standard skill format
3. **Claude Code skill** - `.claude/skills/gh-my-starred/SKILL.md`
4. **GitHub Copilot skill** - `.github/skills/gh-my-starred/SKILL.md`
5. **PI extension** - Provides `starred_repos` tool
6. **GitHub CLI** - Can call `gh my-starred --json` for JSON output

### Related Projects

- [fzf](https://github.com/junegunn/fzf) - Fuzzy finder used for interactive mode
- [gh](https://cli.github.com/) - GitHub CLI this extension is built for
- [PI](https://github.com/marioechler/pi) - AI agent harness with native extension support

## Updating

```bash
gh extension upgrade kylebrodeur/gh-my-starred
```

Or via skills:
```bash
npx skills update kylebrodeur/gh-my-starred
```

## Uninstall

```bash
gh extension remove kylebrodeur/gh-my-starred
```

To also remove the skill registration:
```bash
npx skills remove kylebrodeur/gh-my-starred
```

## License

MIT © [kylebrodeur](https://github.com/kylebrodeur)
