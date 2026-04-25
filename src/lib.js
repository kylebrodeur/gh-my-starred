/**
 * Shared library for gh-my-starred
 * Cache, GitHub API, and scraping utilities
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const { homedir } = require("os");

// ── Constants ──────────────────────────────────────────────────────

const CACHE_DIR = process.env.XDG_CACHE_HOME
  ? path.join(process.env.XDG_CACHE_HOME, "gh-my-starred")
  : path.join(homedir(), ".cache", "gh-my-starred");

const STARRED_CACHE = path.join(CACHE_DIR, "starred-repos.json");
const LISTS_DIR = path.join(CACHE_DIR, "lists");
const CACHE_TTL = parseInt(process.env.GH_STARRED_CACHE_TTL || "3600", 10);

// ── Cache utilities ────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeCache(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
}

function readCache(file) {
  try {
    const data = fs.readFileSync(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function cacheAge(file) {
  try {
    const stat = fs.statSync(file);
    return Math.floor((Date.now() - stat.mtimeMs) / 1000);
  } catch {
    return Infinity;
  }
}

function isCacheFresh(file) {
  return cacheAge(file) < CACHE_TTL;
}

function loadCachedRepos() {
  return readCache(STARRED_CACHE);
}

function saveCachedRepos(repos) {
  writeCache(STARRED_CACHE, repos);
}

function loadListCache(listName) {
  const slug = slugify(listName);
  return readCache(path.join(LISTS_DIR, `${slug}.json`));
}

function saveListCache(listName, orderedRepos) {
  const slug = slugify(listName);
  writeCache(path.join(LISTS_DIR, `${slug}.json`), {
    fetchedAt: new Date().toISOString(),
    repos: orderedRepos
  });
}

// ── String utilities ───────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function titleCase(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Shell helpers ──────────────────────────────────────────────────

function execGh(args, options = {}) {
  try {
    const stdout = execSync(`gh ${args.map(a => JSON.stringify(a)).join(" ")}`, {
      encoding: "utf-8",
      timeout: options.timeout || 120000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { code: 0, stdout: stdout.trim(), stderr: "" };
  } catch (e) {
    return {
      code: e.status || 1,
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || ""
    };
  }
}

function execCurl(url, options = {}) {
  try {
    const stdout = execSync(`curl -sL ${JSON.stringify(url)}`, {
      encoding: "utf-8",
      timeout: options.timeout || 30000
    });
    return { code: 0, stdout: stdout.trim(), stderr: "" };
  } catch (e) {
    return {
      code: e.status || 1,
      stdout: "",
      stderr: e.stderr?.toString() || ""
    };
  }
}

// ── GitHub user ────────────────────────────────────────────────────

let cachedUser = null;
function getGitHubUser() {
  if (cachedUser) return cachedUser;
  const result = execGh(["api", "user", "--jq", ".login"], { timeout: 10000 });
  cachedUser = result.code === 0 ? result.stdout.trim() : null;
  return cachedUser;
}

// ── Starred repos ─────────────────────────────────────────────────

function fetchStarredRepos(limit = 500) {
  const result = execGh(
    ["api", "--paginate", "user/starred?sort=created&direction=desc&per_page=100", "--jq", "."],
    { timeout: 120000 }
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to fetch starred repos");
  }
  let repos = JSON.parse(result.stdout);
  if (!Array.isArray(repos)) repos = [];
  return repos.slice(0, limit);
}

function getLatestStarredDate() {
  const result = execGh(["api", "user/starred?per_page=1", "--jq", ".[0].starred_at"], { timeout: 10000 });
  return result.code === 0 ? result.stdout.trim() : "";
}

function checkUpdateNeeded() {
  const repos = loadCachedRepos();
  if (!repos) return true;
  const cacheLatest = repos
    .slice()
    .sort((a, b) => new Date(b.starred_at || b.updated_at) - new Date(a.starred_at || a.updated_at))[0];
  const apiLatest = getLatestStarredDate();
  if (!apiLatest) return false; // Can't check, use cache
  return apiLatest !== (cacheLatest?.starred_at || cacheLatest?.updated_at || "");
}

// ── Star list discovery ───────────────────────────────────────────

function fetchStarLists() {
  const user = getGitHubUser();
  if (!user) throw new Error("Could not determine GitHub username");

  // Try GraphQL first
  const query = `query($login: String!) {
    user(login: $login) {
      lists(first: 100) {
        nodes {
          name
          description
          items(first: 1) { totalCount }
        }
      }
    }
  }`;

  const gqlResult = execGh(
    ["api", "graphql", "-F", `login=${user}`, "-f", "query=" + query],
    { timeout: 30000 }
  );

  if (gqlResult.code === 0) {
    try {
      const data = JSON.parse(gqlResult.stdout);
      if (data?.data?.user?.lists?.nodes) {
        return data.data.user.lists.nodes
          .filter(n => n.name)
          .map(n => ({
            name: n.name,
            url: `https://github.com/stars/${user}/lists/${slugify(n.name)}`,
            repoCount: n.items?.totalCount
          }));
      }
    } catch { /* fall through */ }
  }

  // Fallback: scrape the stars page
  const webResult = execCurl(`https://github.com/stars/${user}`);
  if (webResult.code === 0) {
    const lists = [];
    const seen = new Set();
    const regex = /href="\/stars\/[^"]+\/lists\/([^"]+)"/g;
    let m;
    while ((m = regex.exec(webResult.stdout)) !== null) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      lists.push({
        name: titleCase(decodeURIComponent(slug)),
        url: `https://github.com/stars/${user}/lists/${slug}`
      });
    }
    if (lists.length > 0) return lists;
  }

  return [];
}

// ── List repo scraping (preserves order!) ─────────────────────────

const DELAY_MS = 500; // polite delay between pages

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchListReposOrdered(listName) {
  const user = getGitHubUser();
  if (!user) throw new Error("Could not determine GitHub username");

  const slug = slugify(listName);
  const seen = new Set();
  const ordered = [];

  for (let page = 1; page <= 20; page++) {
    const url = `https://github.com/stars/${user}/lists/${slug}?page=${page}`;
    const result = execCurl(url, { timeout: 30000 });

    if (result.code !== 0) break;

    const html = result.stdout;
    let foundOnPage = false;
    const regex = /href="\/([^\/"]+\/[^\/"]+)"/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const fullName = m[1];
      // Skip non-repo patterns
      if (/\?|stargazers|forks|login|signup|features\/|security\/|settings\//.test(fullName)) continue;
      if (!fullName.includes("/")) continue;
      if (seen.has(fullName)) continue;
      seen.add(fullName);
      ordered.push(fullName);
      foundOnPage = true;
    }

    if (!foundOnPage) break;
    if (page < 20) await sleep(DELAY_MS);
  }

  return ordered;
}

// ── Cross-reference list repos with starred cache ────────────────

function enrichListRepos(orderedNames, starredRepos) {
  const map = new Map();
  if (Array.isArray(starredRepos)) {
    starredRepos.forEach(r => map.set(r.full_name, r));
  }

  return orderedNames.map(name => {
    if (map.has(name)) return map.get(name);
    const [owner, repo] = name.split("/");
    return {
      full_name: name,
      owner: owner || name,
      repo: repo || "",
      description: null,
      stargazers_count: 0,
      language: null,
      html_url: `https://github.com/${name}`,
      topics: [],
      updated_at: "",
      _enriched: false
    };
  });
}

// ── Compare lists ─────────────────────────────────────────────────

function compareLists(namesA, namesB) {
  const setA = new Set(namesA);
  const setB = new Set(namesB);
  return {
    shared: namesA.filter(n => setB.has(n)),
    onlyA: namesA.filter(n => !setB.has(n)),
    onlyB: namesB.filter(n => !setA.has(n)),
    counts: { a: namesA.length, b: namesB.length }
  };
}

// ── Formatting ─────────────────────────────────────────────────────

function formatRepo(repo) {
  return `• ${repo.full_name} (${repo.stargazers_count}⭐)${repo.language ? ` [${repo.language}]` : ""}${repo.description ? ` - ${repo.description.slice(0, 100)}${repo.description.length > 100 ? "..." : ""}` : ""}`;
}

function formatRepoList(repos, maxItems = 20) {
  if (repos.length === 0) return "No repositories found.";
  const summary = repos.slice(0, maxItems).map(formatRepo).join("\n");
  let text = `Found ${repos.length} repositories:\n\n${summary}`;
  if (repos.length > maxItems) {
    text += `\n\n... and ${repos.length - maxItems} more`;
  }
  return text;
}

// ── Filtering ─────────────────────────────────────────────────────

function applyFilters(repos, { language, topic, search, minStars }) {
  let filtered = repos;
  if (language) {
    const l = language.toLowerCase();
    filtered = filtered.filter(r => r.language?.toLowerCase() === l);
  }
  if (topic) {
    const t = topic.toLowerCase();
    filtered = filtered.filter(r => r.topics?.some(x => x.toLowerCase() === t));
  }
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.full_name.toLowerCase().includes(s) ||
      (r.description?.toLowerCase() || "").includes(s)
    );
  }
  if (minStars > 0) {
    filtered = filtered.filter(r => r.stargazers_count >= minStars);
  }
  return filtered;
}

function sortRepos(repos, sortBy = "stars") {
  return repos.slice().sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.full_name.localeCompare(b.full_name);
      case "updated":
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
      case "starred_at":
        return new Date(b.starred_at || b.updated_at || 0).getTime() - new Date(a.starred_at || a.updated_at || 0).getTime();
      case "stars":
      default:
        return b.stargazers_count - a.stargazers_count;
    }
  });
}

// ── Exports ────────────────────────────────────────────────────────

module.exports = {
  CACHE_DIR,
  STARRED_CACHE,
  LISTS_DIR,
  CACHE_TTL,
  ensureDir,
  writeCache,
  readCache,
  cacheAge,
  isCacheFresh,
  loadCachedRepos,
  saveCachedRepos,
  loadListCache,
  saveListCache,
  slugify,
  titleCase,
  execGh,
  execCurl,
  getGitHubUser,
  fetchStarredRepos,
  getLatestStarredDate,
  checkUpdateNeeded,
  fetchStarLists,
  fetchListReposOrdered,
  enrichListRepos,
  compareLists,
  formatRepo,
  formatRepoList,
  applyFilters,
  sortRepos
};
