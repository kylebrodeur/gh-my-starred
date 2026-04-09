# GitHub Copilot Instructions for gh-my-starred

## Project Overview

gh-my-starred is a GitHub CLI extension for interactively browsing and querying starred repositories.

## Key Information

- **Language**: Bash shell script
- **Primary Feature**: Fuzzy search + JSON output for scripting
- **Caching**: Smart cache for 1000+ starred repos at `~/.cache/gh-my-starred/`
- **PI Extension**: TypeScript extension at `.pi/extensions/gh-my-starred.ts`

## Coding Standards

- Follow POSIX bash where possible
- Use `jq` for JSON processing
- Support `XDG_CACHE_HOME` environment variable
- Handle errors gracefully with informative messages

## Testing

Run test suite:
```bash
bash test/run.sh
```

## File Structure

```
gh-my-starred          # Main executable
.pi/extensions/        # PI extension
test/                  # Test files
SKILL.md               # agentskills.io format
.claude/skills/        # Claude Code skill
.github/skills/        # GitHub Copilot skill
```

## Dependencies

- `gh` CLI (GitHub CLI)
- `fzf` (for interactive mode)
- `jq` (recommended for JSON processing)
