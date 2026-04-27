# TODO

## Fix JSON Parse Error in `starred_repos` Tool

### The Issue
When running the `starred_repos` tool to fetch the user's stars from GitHub (e.g., when the cache is empty or `--refresh` is passed), the tool crashes with the following error:
```
Unexpected non-whitespace character after JSON at position X (line 2 column 1)
```

### What Happened
In `.pi/extensions/gh-my-starred.ts`, the `fetchStarredRepos` function executes the following command:
```bash
gh api --paginate user/starred?sort=created&direction=desc&per_page=100 --jq .
```
Because of the `--paginate` flag, the GitHub CLI makes multiple paginated requests and concatenates the resulting JSON arrays into `stdout` line by line, producing output that looks like this:
```json
[ { "id": 1 } ]
[ { "id": 2 } ]
```
When `JSON.parse(result.stdout)` attempts to parse this multi-document output as a single string, it throws a syntax error when it hits the start of the second array on line 2.

### Proposed Fix
The output arrays need to be concatenated into a single JSON array before parsing. Update the `fetchStarredRepos` function in `.pi/extensions/gh-my-starred.ts` to normalize the JSON string by replacing adjacent array boundaries with a comma.

```typescript
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to fetch starred repos");
  }

  // Handle concatenated JSON arrays from gh api --paginate
  const normalizedJson = result.stdout.trim()
    .replace(/\]\s*\[/g, ',')  // join adjacent arrays separated by whitespace/newlines
    .replace(/\]\n\[/g, ',');  // join newline-separated arrays (just in case)

  const repos = JSON.parse(normalizedJson) as StarredRepo[];
  return repos.slice(0, limit);
```
Alternatively, use `jq -s 'add'` or `jq -s 'flatten'` in the `gh api` call instead of just `.`, which will make `jq` combine the paginated arrays into one array before returning them to `stdout`.

```bash
gh api --paginate user/starred?sort=created&direction=desc&per_page=100 --jq -s 'add'
```
*(Note: Be sure to test the `jq` flag compatibility if updating the bash command instead of the JS regex).*