# gh-my-starred

[![GitHub CLI](https://img.shields.io/badge/github--cli-extension-brightgreen?logo=github)](https://cli.github.com/)

A [GitHub CLI](https://cli.github.com/) extension to interactively browse your starred repositories.

## Installation

```bash
gh extension install kylebrodeur/gh-my-starred
```

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) - authenticated
- [fzf](https://github.com/junegunn/fzf) - Fuzzy finder

## Usage

```bash
gh my-starred [limit]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `limit`  | Maximum number of repositories to fetch (default: all) |

### Examples

```bash
gh my-starred         # Browse all starred repos
gh my-starred 100     # Browse last 100 starred repos
gh my-starred --help  # Show help
```

### Interactive Keys

| Key | Action |
|-----|--------|
| `↑/↓` | Navigate |
| `Enter` | Open selected repo in browser |
| `Ctrl-C` | Exit |

## Features

- 🔍 Fuzzy search through all your starred repos
- 👁️ Live preview of repo details
- ⌨️ Keyboard-driven navigation
- 🌐 One-key open in browser
- 🏷️ Optional limit for large star lists

## Updating

```bash
gh extension upgrade kylebrodeur/gh-my-starred
```

## Uninstall

```bash
gh extension remove kylebrodeur/gh-my-starred
```

## License

MIT © [kylebrodeur](https://github.com/kylebrodeur)
