---
name: gh-my-starred
description: Browse and query GitHub starred repositories and star lists via CLI. Use when the user wants to find, search, filter, analyze, or browse their GitHub starred repositories or curated star lists.
allowed-tools: shell
---

# GitHub Starred Repositories Skill

This skill helps you browse, search, and analyze your GitHub starred repositories and star lists using the gh-my-starred CLI extension.

## When to Use

- Finding a specific repository you previously starred
- Searching starred repos by language, topic, or keywords
- Getting a list of your starred repositories
- Analyzing patterns in your stars (languages, topics, popularity)
- Exporting your starred repos to a file
- Discovering or browsing your star lists (curated collections)

## Usage

### Basic Commands

```bash
# List all starred repos as JSON
gh my-starred --json

# Search by language
gh my-starred --json | jq '.[] | select(.language == "Python") | .full_name'

# Get top 10 most starred
gh my-starred --json | jq 'sort_by(.stargazers_count) | reverse | .[:10]'

# Filter by topic
gh my-starred --json | jq '.[] | select(.topics | index("machine-learning"))'
```

### With Limits

```bash
# Get only 50 most recent stars
gh my-starred --json 50
```

### Star Lists

```bash
# Discover all star lists
gh my-starred --lists

# Browse a specific list interactively
gh my-starred --list "Favorites"

# Export a list as JSON (preserves order)
gh my-starred --list "Research" --json
```

## JSON Output Schema

Each repository object includes:
- `full_name`: "owner/repo" format
- `description`: Repository description
- `stargazers_count`: Number of stars
- `language`: Primary language
- `html_url`: Repository URL
- `topics`: Array of topic tags
- `updated_at`: Last update timestamp

## Notes

- Requires `gh` CLI to be installed and authenticated with GitHub
- Uses smart caching for large star lists (1000+ repos)
- Cache is stored at `~/.cache/gh-my-starred/starred-repos.json`
- Star lists are scraped from GitHub's web UI since there is no public API for them
- List contents are cached separately at `~/.cache/gh-my-starred/lists/`
- Use `--refresh` flag to force cache refresh
- Use `--list-refresh` to force refresh a specific list cache
