---
name: gh-my-starred
description: Browse and query GitHub starred repositories via CLI. Use when the user wants to find, search, filter, or analyze their GitHub starred repositories.
triggers:
  - phrase: search my starred repos
  - phrase: find in my stars
  - phrase: browse starred repositories
  - phrase: list my starred repos
  - phrase: filter my github stars
  - phrase: analyze my starred repos
allowed-tools: [Read, Bash, Bash(gh *)]
---

# GitHub Starred Repositories Skill

This skill helps you browse, search, and analyze your GitHub starred repositories.

## When to Use

- Finding a specific repository you previously starred
- Searching starred repos by language, topic, or keywords
- Getting a list of your starred repositories
- Analyzing patterns in your stars (languages, topics, popularity)
- Exporting your starred repos to a file

## Usage

### Basic Commands

```bash
# List all starred repos
gh my-starred --json

# Search by language
gh my-starred --json | jq '.[] | select(.language == "Python") | .full_name'

# Get top 10 most starred
gh my-starred --json | jq 'sort_by(.stargazers_count) | reverse | .[:10]'

# Filter by topic
gh my-starred --json | jq '.[] | select(.topics | index("machine-learning"))'
```

### Parameters Available

- `limit`: Max repos to return (default: all)
- `language`: Filter by programming language
- `topic`: Filter by topic tag
- `search`: Search in name/description
- `minStars`: Minimum star count
- `sortBy`: Sort by `stars`, `updated`, or `name`

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

- Requires `gh` CLI authenticated with GitHub
- Uses smart caching for 1000+ stars
- Cache location: `~/.cache/gh-my-starred/starred-repos.json`
