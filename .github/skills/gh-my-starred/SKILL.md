---
name: gh-my-starred
description: Browse and query GitHub starred repositories and star lists via CLI.
allowed-tools: shell
---

# GitHub Starred Repositories Skill

## Installation

### Terminal CLI
```bash
gh extension install kylebrodeur/gh-my-starred
```

### PI Package
```bash
pi install git:github.com/kylebrodeur/gh-my-starred@v0.2.0
```

### Both
```bash
gh extension install kylebrodeur/gh-my-starred
pi install git:github.com/kylebrodeur/gh-my-starred@v0.2.0
```

## Usage

```bash
gh my-starred --json
gh my-starred --lists
gh my-starred --list "Favorites" --json
```

## Notes

- Terminal and PI package are independent
- PI tools call GitHub API directly
- `/starred` command requires both
- `gh` CLI must be authenticated
