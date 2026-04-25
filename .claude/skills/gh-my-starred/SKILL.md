---
name: gh-my-starred
description: Browse and query GitHub starred repositories and star lists via CLI. Use when the user wants to find, search, filter, analyze, or browse their GitHub starred repositories or curated star lists.
triggers:
  - phrase: search my starred repos
  - phrase: find in my stars
  - phrase: browse starred repositories
  - phrase: list my starred repos
  - phrase: filter my github stars
  - phrase: analyze my starred repos
  - phrase: my star lists
  - phrase: repos in my list
  - phrase: compare my lists
allowed-tools: [Read, Bash, Bash(gh *)]
---

# GitHub Starred Repositories Skill

This skill helps you browse, search, and analyze your GitHub starred repositories and star lists.

## When to Use

- Finding a specific repository you previously starred
- Searching starred repos by language, topic, or keywords
- Getting a list of your starred repositories
- Analyzing patterns in your stars (languages, topics, popularity)
- Exporting your starred repos to a file
- Discovering or browsing your star lists (curated collections)
- Comparing repos between two star lists

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

### Star Lists

```bash
# Discover all star lists
gh my-starred --lists

# Browse a specific list interactively
gh my-starred --list "Favorites"

# Export a list as JSON (preserves order)
gh my-starred --list "Research" --json

# Refresh a specific list cache
gh my-starred --list "Favorites" --list-refresh --json
```

### PI Tools (when used inside PI)

- `starred_repos`: Query all starred repos with filtering
- `list_star_lists`: Discover all star lists
- `get_list_repos`: Get ordered repos from a specific list
- `compare_lists`: Compare two lists for shared/unique repos

### Parameters Available

- `limit`: Max repos to return (default: all)
- `language`: Filter by programming language
- `topic`: Filter by topic tag
- `search`: Search in name/description
- `minStars`: Minimum star count
- `sortBy`: Sort by `stars`, `updated`, `name`, or `starred_at`

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
- Star lists are scraped from GitHub's web UI since there is no public API for them
- List contents are cached separately at `~/.cache/gh-my-starred/lists/`
- Cache location: `~/.cache/gh-my-starred/starred-repos.json`
