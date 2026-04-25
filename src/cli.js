#!/usr/bin/env node
/**
 * gh-my-starred CLI
 * Replaces the bash script with a Node.js implementation.
 */

const {
  loadCachedRepos,
  saveCachedRepos,
  loadListCache,
  saveListCache,
  isCacheFresh,
  STARRED_CACHE,
  fetchStarredRepos,
  checkUpdateNeeded,
  fetchStarLists,
  fetchListReposOrdered,
  enrichListRepos,
  applyFilters,
  sortRepos,
  formatRepoList,
  execGh,
  getGitHubUser,
  slugify
} = require("./lib");

const VERSION = "0.2.2";

function showHelp() {
  console.log(`gh my-starred - Browse your starred GitHub repositories interactively

USAGE
  gh my-starred [options] [limit]
  gh my-starred --lists
  gh my-starred --list "List Name"
  gh my-starred --list "List Name" --json

OPTIONS
  -h, --help          Show this help message
  -v, --version       Show version number
  -j, --json          Output as JSON (no interactive mode)
  --refresh           Force refresh starred cache
  --ai                Show AI assistant documentation
  --lists             Show all star lists for the user
  --list NAME         Browse/repos in a specific star list (preserves order)
  --list-refresh      Force refresh list cache

ARGS
  limit               Maximum number of repositories to fetch (default: all)

ENVIRONMENT
  GH_STARRED_CACHE_TTL   Cache time-to-live in seconds (default: 3600)
  GH_STARRED_TIMEOUT     API request timeout in ms (default: 120000)

INTERACTIVE KEYS
  ↑/↓      Navigate
  Enter    Open selected repo in browser
  Ctrl-C   Exit
  Ctrl-R   Refresh cache and reload

REQUIREMENTS
  - GitHub CLI (gh) - authenticated
  - fzf (https://github.com/junegunn/fzf) - for interactive mode
  - jq  (https://jqlang.github.io/jq/)  - for JSON output
`);
}

function showVersion() {
  console.log(`gh-my-starred v${VERSION}`);
}

function showAiDocs() {
  const possiblePaths = [
    `${__dirname}/../SKILL.md`,
    `${__dirname}/SKILL.md`
  ];
  for (const p of possiblePaths) {
    if (require("fs").existsSync(p)) {
      console.log(require("fs").readFileSync(p, "utf-8"));
      return;
    }
  }
  console.log(`# AI Assistant Guide for gh-my-starred
Full documentation: https://github.com/kylebrodeur/gh-my-starred/blob/main/SKILL.md`);
}

function checkGhAuth() {
  const result = execGh(["api", "user", "--jq", ".login"], { timeout: 10000 });
  if (result.code !== 0) {
    console.error("Error: Not authenticated with GitHub CLI. Run: gh auth login");
    process.exit(1);
  }
}

function checkFzf() {
  try {
    require("child_process").execSync("which fzf", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function runInteractive(repos, header, prompt) {
  if (!checkFzf()) {
    console.error("Error: fzf is required for interactive mode.");
    console.error("Install: https://github.com/junegunn/fzf#installation");
    process.exit(1);
  }

  const repoNames = repos.map(r => r.full_name).join("\n");
  const { spawn } = require("child_process");

  return new Promise((resolve) => {
    const fzf = spawn("fzf", [
      "--preview", "gh repo view {} 2>/dev/null || echo 'Loading...'",
      "--preview-window", "right:60%:wrap",
      "--header", header,
      "--prompt", `${prompt}> `,
      "--height", "80%"
    ], { stdio: ["pipe", "pipe", "inherit"] });

    fzf.stdin.write(repoNames);
    fzf.stdin.end();

    let selected = "";
    fzf.stdout.on("data", data => { selected += data; });
    fzf.on("close", (code) => {
      selected = selected.trim();
      if (selected && code === 0) {
        try {
          require("child_process").spawnSync("gh", ["repo", "view", selected, "--web"], { stdio: "inherit" });
        } catch {
          console.error(`Could not open ${selected} in browser.`);
        }
      }
      resolve();
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  let jsonMode = false;
  let forceRefresh = false;
  let listsMode = false;
  let listName = "";
  let listRefresh = false;
  let limit = null;
  let positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") { showHelp(); process.exit(0); }
    if (arg === "-v" || arg === "--version") { showVersion(); process.exit(0); }
    if (arg === "-j" || arg === "--json") { jsonMode = true; }
    else if (arg === "--refresh") { forceRefresh = true; }
    else if (arg === "--ai") { showAiDocs(); process.exit(0); }
    else if (arg === "--lists") { listsMode = true; }
    else if (arg === "--list") { listName = args[++i] || ""; jsonMode = true; }
    else if (arg === "--list-refresh") { listRefresh = true; }
    else if (arg.startsWith("--list=")) { listName = arg.slice(7); jsonMode = true; }
    else if (arg.startsWith("-")) {
      console.error(`Error: Unknown option ${arg}`);
      console.error("Run 'gh my-starred --help' for usage");
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    limit = parseInt(positional[0], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error("Error: limit must be a positive number");
      process.exit(1);
    }
  }

  // ── Lists mode ──────────────────────────────────────────────────
  if (listsMode) {
    console.error("Discovering star lists...");
    try {
      const lists = fetchStarLists();
      if (lists.length === 0) {
        console.log("No star lists found. Create lists at https://github.com/stars.");
        process.exit(0);
      }
      console.log(lists.map(l => l.name).join("\n"));
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Single list mode ────────────────────────────────────────────
  if (listName) {
    console.error(`Loading list: ${listName}`);
    let orderedNames = null;

    if (!listRefresh) {
      const cached = loadListCache(listName);
      if (cached?.repos) {
        orderedNames = cached.repos;
        console.error(`Using cached list data (${orderedNames.length} repos)`);
      }
    }

    if (!orderedNames) {
      console.error("Fetching list from GitHub (this may take a moment)...");
      orderedNames = await fetchListReposOrdered(listName);
      if (orderedNames.length > 0) {
        saveListCache(listName, orderedNames);
      }
    }

    if (!orderedNames || orderedNames.length === 0) {
      console.error(`Error: Could not fetch list '${listName}'. Check the list exists.`);
      process.exit(1);
    }

    if (limit) orderedNames = orderedNames.slice(0, limit);

    // Cross-reference with starred cache for metadata
    const starred = loadCachedRepos() || [];
    const enriched = enrichListRepos(orderedNames, starred);

    if (jsonMode) {
      console.log(JSON.stringify(enriched, null, 2));
    } else {
      const notEnriched = enriched.filter(r => r._enriched === false).length;
      let text = formatRepoList(enriched);
      if (notEnriched > 0) {
        text += `\n\n⚠ ${notEnriched} repo(s) not found in starred cache. Run 'gh my-starred --refresh' to update.`;
      }
      console.log(text);
    }
    return;
  }

  // ── Normal starred repos mode ───────────────────────────────────
  checkGhAuth();

  let repos = loadCachedRepos();
  let refreshNeeded = forceRefresh;

  if (!repos) {
    console.error("No cache found, fetching...");
    refreshNeeded = true;
  } else if (!isCacheFresh(STARRED_CACHE)) {
    console.error("Cache is stale...");
    if (checkUpdateNeeded()) {
      refreshNeeded = true;
    } else {
      console.error("No new starred repos detected, using cached data");
    }
  }

  if (refreshNeeded) {
    try {
      repos = fetchStarredRepos(limit || 500);
      saveCachedRepos(repos);
    } catch (e) {
      console.error(`Error fetching repos: ${e.message}`);
      if (!repos) process.exit(1);
    }
  }

  if (!repos || repos.length === 0) {
    console.error("Error: No cached data available. Check gh authentication.");
    process.exit(1);
  }

  if (limit) repos = repos.slice(0, limit);

  if (jsonMode) {
    console.log(JSON.stringify(repos, null, 2));
    return;
  }

  // Interactive mode
  const total = repos.length;
  const cacheAge = Math.floor(require("./lib").cacheAge(STARRED_CACHE) / 60);
  const header = `${total} repos | Cache: ${cacheAge}m ago | Ctrl-R: Refresh (use --refresh)`;

  await runInteractive(repos, header, "Starred repos");
}

main().catch(e => {
  console.error(`Unexpected error: ${e.message}`);
  process.exit(1);
});
