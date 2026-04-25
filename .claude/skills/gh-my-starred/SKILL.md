---
name: gh-my-starred
description: Browse and query GitHub starred repositories and star lists via CLI. Use when the user wants to find, search, filter, or analyze their GitHub starred repositories.
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

## Installation

### Terminal CLI (for direct use)
```bash
gh extension install kylebrodeur/gh-my-starred
```

### PI Package (for AI agent tools)
```bash
pi install git:github.com/kylebrodeur/gh-my-starred@v0.2.0
```

### Both (for full experience)
```bash
gh extension install kylebrodeur/gh-my-starred
pi install git:github.com/kylebrodeur/gh-my-starred@v0.2.0
```

## Usage

### Basic Commands

```bash
gh my-starred --json
gh my-starred --json | jq '.[] | select(.language == "Python") | .full_name'
gh my-starred --json | jq 'sort_by(.stargazers_count) | reverse | .[:10]'
gh my-starred --lists
gh my-starred --list "Favorites"
```

## Notes

- Terminal CLI and PI package are independent
- PI tools work standalone (call GitHub API directly)
- `/starred` command in PI requires both CLI and PI package
- Requires `gh` CLI authenticated with GitHub
