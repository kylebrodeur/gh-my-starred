# gh-my-starred

A [GitHub CLI](https://cli.github.com/) extension to interactively browse your starred repositories.

## Installation

```bash
gh extension install kylebrodeur/gh-my-starred
```

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`)
- [fzf](https://github.com/junegunn/fzf) - Fuzzy finder

## Usage

```bash
gh my-starred
```

This will:
1. Fetch all your starred repositories
2. Present them in an interactive `fzf` interface
3. Show a preview of each repository
4. Open the selected repository in your browser on Enter

## Features

- 🔍 Fuzzy search through all your starred repos
- 👁️ Live preview of repo details
- ⌨️ Keyboard-driven navigation
- 🌐 One-key open in browser

## Uninstall

```bash
gh extension remove kylebrodeur/gh-my-starred
```

## License

MIT
