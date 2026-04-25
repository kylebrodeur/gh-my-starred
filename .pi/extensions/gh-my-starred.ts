/**
 * gh-my-starred PI Extension
 *
 * Provides tools for AI agents to browse the user's GitHub starred
 * repositories and star lists with caching support.
 *
 * Tools:
 *   - starred_repos:    Query and filter starred repositories
 *   - list_star_lists:  Discover all star lists for the user
 *   - get_list_repos:   Get ordered repos from a specific star list
 *   - compare_lists:    Compare two star lists
 *
 * Commands:
 *   /starred            - Interactive fzf browser for starred repos
 *   /starred list       - Browse a specific star list
 *
 * Requires: gh cli with authentication
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────

interface StarredRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  html_url: string;
  topics: string[];
  updated_at: string;
  starred_at?: string;
}

interface StarListInfo {
  name: string;
  url: string;
  repoCount?: number;
}

interface ListCacheEntry {
  fetchedAt: string;
  repos: string[]; // ordered full_names
}

// ── Cache helpers ────────────────────────────────────────────────────

const CACHE_DIR = process.env.XDG_CACHE_HOME
  ? join(process.env.XDG_CACHE_HOME, "gh-my-starred")
  : join(homedir(), ".cache", "gh-my-starred");

const STARRED_CACHE = join(CACHE_DIR, "starred-repos.json");
const LISTS_CACHE = join(CACHE_DIR, "star-lists.json");
const LISTS_DIR = join(CACHE_DIR, "lists");

async function ensureCache() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(LISTS_DIR, { recursive: true });
}

async function loadCachedRepos(): Promise<StarredRepo[] | null> {
  try {
    const data = await readFile(STARRED_CACHE, "utf-8");
    return JSON.parse(data) as StarredRepo[];
  } catch (_e) {
    return null;
  }
}

async function saveCachedRepos(repos: StarredRepo[]) {
  await ensureCache();
  await writeFile(STARRED_CACHE, JSON.stringify(repos), { mode: 0o600 });
}

async function loadListCache(listName: string): Promise<ListCacheEntry | null> {
  try {
    const data = await readFile(join(LISTS_DIR, `${listName}.json`), "utf-8");
    return JSON.parse(data) as ListCacheEntry;
  } catch (_e) {
    return null;
  }
}

async function saveListCache(listName: string, repos: string[]) {
  await ensureCache();
  const entry: ListCacheEntry = { fetchedAt: new Date().toISOString(), repos };
  await writeFile(join(LISTS_DIR, `${listName}.json`), JSON.stringify(entry), { mode: 0o600 });
}

// ── GitHub API helpers ─────────────────────────────────────────────

async function fetchStarredRepos(pi: ExtensionAPI, signal?: AbortSignal, limit = 500): Promise<StarredRepo[]> {
  // Use gh api with pagination for full data
  const result = await pi.exec("gh", [
    "api", "--paginate", "user/starred?sort=created&direction=desc&per_page=100",
    "--jq", "."
  ], { signal, timeout: 120000 });

  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to fetch starred repos");
  }

  const repos = JSON.parse(result.stdout) as StarredRepo[];
  return repos.slice(0, limit);
}

/**
 * Fetch star lists by scraping the GitHub web UI.
 * There is no public API for listing star lists.
 */
async function fetchStarLists(pi: ExtensionAPI, signal?: AbortSignal): Promise<StarListInfo[]> {
  // Try GraphQL first (undocumented but sometimes works)
  const query = `
    query($login: String!) {
      user(login: $login) {
        lists(first: 100) {
          nodes {
            name
            description
            items(first: 1) { totalCount }
          }
        }
      }
    }
  `;

  // Get username from gh
  const userResult = await pi.exec("gh", ["api", "user", "--jq", ".login"], { signal, timeout: 10000 });
  const username = userResult.stdout.trim();
  if (!username) throw new Error("Could not determine GitHub username");

  const gqlResult = await pi.exec("gh", [
    "api", "graphql",
    "-F", `login=${username}`,
    "-f", "query=" + query
  ], { signal, timeout: 30000 });

  if (gqlResult.code === 0) {
    const data = JSON.parse(gqlResult.stdout);
    if (data?.data?.user?.lists?.nodes) {
      return data.data.user.lists.nodes
        .filter((n: any) => n.name)
        .map((n: any) => ({
          name: n.name,
          url: `https://github.com/stars/${username}/lists/${encodeURIComponent(n.name.toLowerCase().replace(/\s+/g, "-"))}`,
          repoCount: n.items?.totalCount
        }));
    }
  }

  // Fallback: scrape the stars page for list names
  const webResult = await pi.exec("curl", [
    "-sL", `https://github.com/stars/${username}`
  ], { signal, timeout: 30000 });

  if (webResult.code === 0) {
    const html = webResult.stdout;
    const lists: StarListInfo[] = [];

    // Match list URLs like /stars/username/lists/list-name
    const seen = new Set<string>();
    for (const match of html.matchAll(/href="\/stars\/[^"]+\/lists\/([^"]+)"/g)) {
      const slug = match[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      lists.push({
        name: decodeURIComponent(slug).replace(/-/g, " ").replace(/(^|\s)\w/g, c => c.toUpperCase()),
        url: `https://github.com/stars/${username}/lists/${slug}`
      });
    }

    if (lists.length > 0) return lists;
  }

  // If both fail, return empty (maybe no lists or API limit)
  return [];
}

/**
 * Fetch ordered repos from a star list via HTML scraping.
 * Returns repo full_names in the order they appear in the list.
 */
async function fetchListReposOrdered(pi: ExtensionAPI, listName: string, signal?: AbortSignal): Promise<string[]> {
  const userResult = await pi.exec("gh", ["api", "user", "--jq", ".login"], { signal, timeout: 10000 });
  const username = userResult.stdout.trim();
  if (!username) throw new Error("Could not determine GitHub username");

  // Determine slug: convert spaces to hyphens, lowercase
  const slug = listName.toLowerCase().replace(/\s+/g, "-");

  const orderedRepos: string[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 20; page++) {
    const result = await pi.exec("curl", [
      "-sL", `https://github.com/stars/${username}/lists/${slug}?page=${page}`
    ], { signal, timeout: 30000 });

    if (result.code !== 0) break;

    const html = result.stdout;
    let foundOnPage = false;

    // Match repo links: href="/owner/repo"
    for (const match of html.matchAll(/href="\/([^\/"]+\/[^\/"]+)"/g)) {
      const fullName = match[1];

      // Skip non-repo patterns
      if (/\?|stargazers|forks|login|signup|features\/|security\/|settings\//.test(fullName)) continue;
      if (seen.has(fullName)) continue;

      seen.add(fullName);
      orderedRepos.push(fullName);
      foundOnPage = true;
    }

    if (!foundOnPage) break;
  }

  return orderedRepos;
}

// ── Result formatting ──────────────────────────────────────────────

function formatRepoSummary(repos: StarredRepo[], maxItems = 20): string {
  if (repos.length === 0) return "No repositories found.";
  const summary = repos.slice(0, maxItems).map(r =>
    `• ${r.full_name} (${r.stargazers_count}⭐)${r.language ? ` [${r.language}]` : ""}${r.description ? ` - ${r.description.slice(0, 100)}${r.description.length > 100 ? "..." : ""}` : ""}`
  ).join("\n");

  let text = `Found ${repos.length} repositories${repos.length !== repos.length ? ` (filtered from ${repos.length} total)` : ""}:\n\n${summary}`;
  if (repos.length > maxItems) {
    text += `\n\n... and ${repos.length - maxItems} more`;
  }
  return text;
}

function applyFilters(repos: StarredRepo[], language?: string, topic?: string, search?: string, minStars?: number): StarredRepo[] {
  let filtered = repos;
  if (language) {
    const langLower = language.toLowerCase();
    filtered = filtered.filter(r => r.language?.toLowerCase() === langLower);
  }
  if (topic) {
    const topicLower = topic.toLowerCase();
    filtered = filtered.filter(r => r.topics?.some(t => t.toLowerCase() === topicLower));
  }
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.full_name.toLowerCase().includes(searchLower) ||
      (r.description?.toLowerCase() || "").includes(searchLower)
    );
  }
  if (minStars && minStars > 0) {
    filtered = filtered.filter(r => r.stargazers_count >= minStars);
  }
  return filtered;
}

function sortRepos(repos: StarredRepo[], sortBy = "stars"): StarredRepo[] {
  return [...repos].sort((a, b) => {
    switch (sortBy) {
      case "name": return a.full_name.localeCompare(b.full_name);
      case "updated": return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      case "starred_at": return new Date(b.starred_at || b.updated_at).getTime() - new Date(a.starred_at || a.updated_at).getTime();
      case "stars":
      default:
        return b.stargazers_count - a.stargazers_count;
    }
  });
}

// ── Extension ──────────────────────────────────────────────────────

export default function ghMyStarredExtension(pi: ExtensionAPI) {

  // ── TOOL: starred_repos ──────────────────────────────────────────

  pi.registerTool({
    name: "starred_repos",
    label: "Starred Repos",
    description: "Browse and query the user's GitHub starred repositories. Supports filtering by language, topic, search query, minimum stars, and sorting.",
    promptSnippet: "Access the user's GitHub starred repositories to find tools, libraries, or reference implementations",
    promptGuidelines: [
      "Use starred_repos when the user asks about their starred repos or needs to find something they previously starred",
      "Apply filters (language, topic) when the user specifies preferences",
      "Sort by 'stars' to find popular repos, 'updated' for recently active, 'name' for alphabetical",
      "Use search for fuzzy matching repo names or descriptions"
    ],
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Maximum number of repos to return (default: 100, max: 500)" })),
      language: Type.Optional(Type.String({ description: "Filter by programming language (e.g., 'Go', 'Python', 'TypeScript')" })),
      topic: Type.Optional(Type.String({ description: "Filter by topic tag (e.g., 'cli', 'machine-learning')" })),
      search: Type.Optional(Type.String({ description: "Search query for full_name or description" })),
      minStars: Type.Optional(Type.Number({ description: "Minimum stargazer count" })),
      sortBy: Type.Optional(Type.String({ enum: ["stars", "updated", "name", "starred_at"], description: "Sort field (default: stars)" })),
      refresh: Type.Optional(Type.Boolean({ description: "Force refresh cache before querying" }))
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const limit = Math.min(params.limit ?? 100, 500);
      const { language, topic, search, minStars, sortBy, refresh } = params;

      onUpdate?.({ content: [{ type: "text", text: refresh ? "Refreshing starred repositories cache..." : "Loading starred repositories..." }] });

      let repos: StarredRepo[] | null = null;

      if (!refresh) {
        repos = await loadCachedRepos();
        if (repos) {
          onUpdate?.({ content: [{ type: "text", text: `Using cached data (${repos.length} repos)` }] });
        }
      }

      if (!repos) {
        try {
          repos = await fetchStarredRepos(pi, signal, limit);
          await saveCachedRepos(repos);
          onUpdate?.({ content: [{ type: "text", text: `Fetched ${repos.length} repos from GitHub API` }] });
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: "Error fetching starred repos: " + (e instanceof Error ? e.message : String(e)) }]
          };
        }
      }

      let filtered = applyFilters(repos, language, topic, search, minStars);
      filtered = sortRepos(filtered, sortBy ?? "stars").slice(0, limit);

      return {
        content: [{ type: "text", text: filtered.length === 0 ? "No repositories match the filters." : formatRepoSummary(filtered) }],
        details: { repos: filtered, total: repos.length, filtered: filtered.length, filters: { language, topic, search, minStars, sortBy } }
      };
    }
  });

  // ── TOOL: list_star_lists ────────────────────────────────────────

  pi.registerTool({
    name: "list_star_lists",
    label: "List Star Lists",
    description: "Discover all star lists created by the user on GitHub. Star lists are curated collections of starred repositories.",
    promptSnippet: "Find the user's GitHub star lists (curated collections like 'favorites', 'research', 'tools')",
    promptGuidelines: [
      "Use list_star_lists when the user asks about their star lists or curated collections",
      "Star lists have names; use get_list_repos to see what's inside a specific list"
    ],
    parameters: Type.Object({
      refresh: Type.Optional(Type.Boolean({ description: "Force refresh list discovery" }))
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "Discovering star lists..." }] });

      try {
        const lists = await fetchStarLists(pi, signal);

        if (lists.length === 0) {
          return {
            content: [{ type: "text", text: "No star lists found. Create lists at https://github.com/stars." }],
            details: { lists: [] }
          };
        }

        const summary = lists.map(l => `• ${l.name}${l.repoCount !== undefined ? ` (${l.repoCount} repos)` : ""}${l.url ? ` - ${l.url}` : ""}`).join("\n");

        return {
          content: [{ type: "text", text: `Found ${lists.length} star list(s):\n\n${summary}` }],
          details: { lists }
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error discovering lists: " + (e instanceof Error ? e.message : String(e)) }]
        };
      }
    }
  });

  // ── TOOL: get_list_repos ───────────────────────────────────────

  pi.registerTool({
    name: "get_list_repos",
    label: "Get List Repos",
    description: "Get all repositories in a specific star list, preserving the order they were added to the list. Enriches each repo with metadata from the starred repo cache.",
    promptSnippet: "Get ordered repositories from a specific GitHub star list (e.g., 'get_list_repos with listName: favorites')",
    promptGuidelines: [
      "Use get_list_repos when the user mentions a specific star list by name",
      "Repos are returned in the order they appear in the list on GitHub",
      "Metadata is enriched from the starred repo cache (call starred_repos with refresh:true if metadata is stale)"
    ],
    parameters: Type.Object({
      listName: Type.String({ description: "Name of the star list (e.g., 'favorites', 'microfactory research')" }),
      limit: Type.Optional(Type.Number({ description: "Maximum repos to return (default: all)" })),
      refresh: Type.Optional(Type.Boolean({ description: "Force refresh the list contents and cache" })),
      language: Type.Optional(Type.String({ description: "Filter by programming language" })),
      topic: Type.Optional(Type.String({ description: "Filter by topic tag" })),
      search: Type.Optional(Type.String({ description: "Search in name or description" })),
      minStars: Type.Optional(Type.Number({ description: "Minimum stargazer count" })),
      enrich: Type.Optional(Type.Boolean({ description: "Enrich with full metadata from starred cache (default: true)" }))
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const { listName, limit, refresh, language, topic, search, minStars, enrich = true } = params;

      onUpdate?.({ content: [{ type: "text", text: `Loading repos from list "${listName}"...` }] });

      // Try cache first
      let orderedNames: string[] | null = null;
      if (!refresh) {
        const cached = await loadListCache(listName);
        if (cached) {
          orderedNames = cached.repos;
          onUpdate?.({ content: [{ type: "text", text: `Using cached list data (${orderedNames.length} repos)` }] });
        }
      }

      if (!orderedNames) {
        try {
          orderedNames = await fetchListReposOrdered(pi, listName, signal);
          await saveListCache(listName, orderedNames);
          onUpdate?.({ content: [{ type: "text", text: `Fetched ${orderedNames.length} repos from list` }] });
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: "Error fetching list \"" + listName + "\": " + (e instanceof Error ? e.message : String(e)) }]
          };
        }
      }

      // Get starred cache for metadata
      let starredMap = new Map<string, StarredRepo>();
      if (enrich) {
        const starred = await loadCachedRepos();
        if (starred) {
          starred.forEach(r => starredMap.set(r.full_name, r));
        }
      }

      // Build ordered results
      let results: StarredRepo[] = orderedNames
        .map(name => {
          // Prefer starred cache, otherwise create minimal stub
          if (starredMap.has(name)) {
            return starredMap.get(name)!;
          }
          const [owner, repo] = name.split("/");
          return {
            full_name: name,
            description: null,
            stargazers_count: 0,
            language: null,
            html_url: `https://github.com/${name}`,
            topics: [],
            updated_at: ""
          };
        })
        .filter(r => r !== null);

      // Apply filters
      results = applyFilters(results, language, topic, search, minStars);
      if (limit) results = results.slice(0, limit);

      const summary = formatRepoSummary(results);
      const notEnriched = results.filter(r => r.stargazers_count === 0 && !r.language).length;

      let text = summary;
      if (enrich && notEnriched > 0) {
        text += `\n\n⚠️ ${notEnriched} repo(s) not found in starred cache. Run 'starred_repos' with refresh:true to update cache.`;
      }

      return {
        content: [{ type: "text", text }],
        details: {
          listName,
          repos: results,
          totalInList: orderedNames.length,
          filtered: results.length,
          notEnriched: enrich ? notEnriched : undefined,
          order: results.map(r => r.full_name)
        }
      };
    }
  });

  // ── TOOL: compare_lists ────────────────────────────────────────

  pi.registerTool({
    name: "compare_lists",
    label: "Compare Lists",
    description: "Compare two star lists and show which repos are shared, unique, or missing between them.",
    promptSnippet: "Compare two GitHub star lists to find overlaps and differences",
    promptGuidelines: [
      "Use compare_lists when the user wants to see how two lists relate",
      "The result shows shared repos and repos unique to each list"
    ],
    parameters: Type.Object({
      listA: Type.String({ description: "First list name" }),
      listB: Type.String({ description: "Second list name" })
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const { listA, listB } = params;

      onUpdate?.({ content: [{ type: "text", text: `Comparing "${listA}" with "${listB}"...` }] });

      try {
        const [namesA, namesB] = await Promise.all([
          fetchListReposOrdered(pi, listA, signal),
          fetchListReposOrdered(pi, listB, signal)
        ]);

        const setA = new Set(namesA);
        const setB = new Set(namesB);
        const shared = namesA.filter(n => setB.has(n));
        const onlyA = namesA.filter(n => !setB.has(n));
        const onlyB = namesB.filter(n => !setA.has(n));

        const text = [
          `Comparison: "${listA}" vs "${listB}"`,
          "",
          `📁 ${listA}: ${namesA.length} repos`,
          `📁 ${listB}: ${namesB.length} repos`,
          `🔗 Shared: ${shared.length} repos`,
          "",
          shared.length > 0 ? `**Shared (${shared.length}):**\n${shared.slice(0, 20).map(n => `  • ${n}`).join("\n")}${shared.length > 20 ? "\n  ..." : ""}` : "No shared repositories.",
          "",
          onlyA.length > 0 ? `**Only in ${listA} (${onlyA.length}):**\n${onlyA.slice(0, 10).map(n => `  • ${n}`).join("\n")}${onlyA.length > 10 ? "\n  ..." : ""}` : "",
          "",
          onlyB.length > 0 ? `**Only in ${listB} (${onlyB.length}):**\n${onlyB.slice(0, 10).map(n => `  • ${n}`).join("\n")}${onlyB.length > 10 ? "\n  ..." : ""}` : ""
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: { listA, listB, shared, onlyA, onlyB, counts: { a: namesA.length, b: namesB.length, shared: shared.length } }
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error comparing lists: " + (e instanceof Error ? e.message : String(e)) }]
        };
      }
    }
  });

  // ── COMMAND: /starred ──────────────────────────────────────────

  pi.registerCommand("starred", {
    description: "Browse starred repositories with fzf",
    handler: async (args: string, ctx: ExtensionContext) => {
      // Check if gh-my-starred CLI is available
      const ghExtCheck = await pi.exec("gh", ["my-starred", "--version"], { timeout: 5000 });
      if (ghExtCheck.code !== 0) {
        ctx.ui.notify(
          "gh-my-starred CLI not found. Install it: gh extension install kylebrodeur/gh-my-starred",
          "error"
        );
        return;
      }

      // Parse subcommand: /starred list "name" for list browsing
      const trimmed = args.trim();
      if (trimmed.startsWith("list ") || trimmed.startsWith("list\t")) {
        const listName = trimmed.slice(5).trim();
        if (!listName) {
          ctx.ui.notify("Usage: /starred list <list-name>", "error");
          return;
        }
        // Launch fzf with repos from a specific list
        try {
          const ordered = await fetchListReposOrdered(pi, listName, ctx.signal);
          if (ordered.length === 0) {
            ctx.ui.notify(`No repos found in list "${listName}"`, "warning");
            return;
          }
          const tmp = join(CACHE_DIR, `.list-${listName}.tmp`);
          await writeFile(tmp, ordered.join("\n"));
          await pi.exec("fzf", ["--preview", "gh repo view {}", "--preview-window", "right:60%:wrap", "--prompt", "List: " + listName + "> "], {
            timeout: 0,
            cwd: CACHE_DIR
          });
          // Cleanup
          try { await pi.exec("rm", [tmp]); } catch (_) { /* ignore */ }
        } catch (e) {
          ctx.ui.notify("Failed to browse list: " + (e1 instanceof Error ? e1.message : String(e1)), "error");
        }
        return;
      }

      // Default: browse all starred repos
      const limit = parseInt(trimmed, 10) || undefined;
      const limitArg = limit ? [String(limit)] : [];
      try {
        const result = await pi.exec("gh", ["my-starred", ...limitArg], { timeout: 0 });
        if (result.code !== 0) {
          ctx.ui.notify("Failed to launch interactive browser. Is fzf installed?", "error");
        }
      } catch (e) {
        ctx.ui.notify("Error: " + (e instanceof Error ? e.message : String(e)), "error");
      }
    }
  });
}
