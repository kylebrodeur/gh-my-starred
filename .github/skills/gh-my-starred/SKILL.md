---
name: gh-my-starred
description: Browse and query GitHub starred repositories via CLI. Use when the user wants to find, search, filter, or analyze their GitHub starred repositories. Can be invoked via gh my-starred --json for JSON output.
allowed-tools: shell
---

# GitHub Starred Repositories Skill

This skill helps you browse, search, and analyze your GitHub starred repositories using the gh-my-starred CLI extension.

## When to Use

- Finding a specific repository you previously starred
- Searching starred repos by language, topic, or keywords
- Getting a list of your starred repositories
- Analyzing patterns in your stars (languages, topics, popularity)
- Exporting your starred repos to a file

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
- Use `--refresh` flag to force cache refresh
