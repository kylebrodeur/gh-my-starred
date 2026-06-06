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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
// import { sqliteCache } from "../../src/sqlite-cache.js";

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

// ── Cache helpers ────────────────────────────────────────────────

const CACHE_DIR = process.env.XDG_CACHE_HOME
  ? join(process.env.XDG_CACHE_HOME, "gh-my-starred")
  : join(homedir(), ".cache", "gh-my-starred");

const STARRED_CACHE = join(CACHE_DIR, "starred-repos.json");
const LISTS_DIR = join(CACHE_DIR, "lists");

async function ensureCache() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(LISTS_DIR, { recursive: true });
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

// Legacy cache functions for backward compatibility with command-line tool
async function saveLegacyCachedRepos(repos: StarredRepo[]) {
  await ensureCache();
  await writeFile(STARRED_CACHE, JSON.stringify(repos), { mode: 0o600 });
}

// ── GitHub API helpers ─────────────────────────────────────────────

async function fetchStarredRepos(pi: ExtensionAPI, signal?: AbortSignal): Promise<StarredRepo[]> {
  // Use gh api with pagination for full data
  const result = await pi.exec("gh", [
    "api", "--paginate", "user/starred?sort=created&direction=desc&per_page=100",
    "--jq", ".[]"
  ], { signal, timeout: 120000 });

  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to fetch starred repos");
  }

  // gh api --paginate with .[] streams JSON objects, one per line.
  const repos = result.stdout.trim().split('\n')
    .filter(line => line.startsWith('{')) // Ensure we only parse JSON objects
    .map(line => JSON.parse(line)) as StarredRepo[];
  return repos;
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
      "Use search for fuzzy matching repo names or descriptions",
      "For deep investigation of a specific repo, use analyze_repo or the librarian tool"
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

    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const limit = params.limit ?? 100;
      const { language, topic, search, minStars, sortBy, refresh } = params;

      onUpdate?.({ content: [{ type: "text", text: refresh ? "Refreshing starred repositories cache..." : "Loading starred repositories..." }], details: {} });

      let repos: StarredRepo[] | null = null;

      if (!refresh) {
        try {
          // Fall back to old JSON cache
          try {
            const data = await readFile(STARRED_CACHE, "utf-8");
            repos = JSON.parse(data) as StarredRepo[];
            if (repos && repos.length > 0) {
              onUpdate?.({ content: [{ type: "text", text: `Using legacy JSON cache (${repos.length} repos)` }], details: {} });
            }
          } catch (fallbackError) {
            console.warn("Failed to load from JSON cache either:", fallbackError);
          }
        } catch (e) {
          console.warn("Failed to load from SQLite cache, falling back to JSON:", e);
        }
      }

      if (!repos) {
        try {
          repos = await fetchStarredRepos(pi, signal);
          // Also write to the legacy cache for backward compatibility with the command line tool
          await saveLegacyCachedRepos(repos);
          onUpdate?.({ content: [{ type: "text", text: `Fetched ${repos.length} repos from GitHub API` }], details: {} });
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: "Error fetching starred repos: " + (e instanceof Error ? e.message : String(e)) }],
            details: {}
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

    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      onUpdate?.({ content: [{ type: "text", text: "Discovering star lists..." }], details: {} });

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
            content: [{ type: "text", text: "Error discovering lists: " + (e instanceof Error ? e.message : String(e)) }],
            details: {}
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

    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { listName, limit, refresh, language, topic, search, minStars, enrich = true } = params;

      onUpdate?.({ content: [{ type: "text", text: `Loading repos from list "${listName}"...` }], details: {} });

      // Try cache first
      let orderedNames: string[] | null = null;
      if (!refresh) {
        const cached = await loadListCache(listName);
        if (cached) {
          orderedNames = cached.repos;
          onUpdate?.({ content: [{ type: "text", text: `Using cached list data (${orderedNames.length} repos)` }], details: {} });
        }
      }

      if (!orderedNames) {
        try {
          orderedNames = await fetchListReposOrdered(pi, listName, signal);
          await saveListCache(listName, orderedNames);
          onUpdate?.({ content: [{ type: "text", text: `Fetched ${orderedNames.length} repos from list` }], details: {} });
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: "Error fetching list \"" + listName + "\": " + (e instanceof Error ? e.message : String(e)) }],
            details: {}
          };
        }
      }

      // Get starred cache for metadata
      let starredMap = new Map<string, StarredRepo>();
      if (enrich) {
        try {
          const data = await readFile(STARRED_CACHE, "utf-8");
          const starred = JSON.parse(data) as StarredRepo[];
          if (starred) {
            starred.forEach(r => starredMap.set(r.full_name, r));
          }
        } catch (fallbackError) {
          console.warn("Failed to load from JSON cache either:", fallbackError);
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

    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { listA, listB } = params;

      onUpdate?.({ content: [{ type: "text", text: `Comparing "${listA}" with "${listB}"...` }], details: {} });

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
            content: [{ type: "text", text: "Error comparing lists: " + (e instanceof Error ? e.message : String(e)) }],
            details: {}
          };
      }
    }
  });

  // ── TOOL: add_to_star_list ───────────────────────────────────────

  pi.registerTool({
    name: "create_star_list",
    label: "Create Star List",
    description: "Create a new star list on GitHub.",
    promptSnippet: "Create a new GitHub star list for organizing repositories.",
    promptGuidelines: [
      "Use create_star_list when the user wants to create a new list for their starred repos.",
      "The list name must be unique.",
      "A description for the list is optional but recommended."
    ],
    parameters: Type.Object({
      name: Type.String({ description: "The name for the new star list." }),
      description: Type.Optional(Type.String({ description: "An optional description for the list." }))
    }),
    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { name, description } = params;
      onUpdate?.({ content: [{ type: "text", text: `Creating star list "${name}"...` }], details: {} });
      try {
        const userResult = await pi.exec("gh", ["api", "user", "--jq", ".id"], { timeout: 10000 });
        if (userResult.code !== 0) throw new Error("Could not determine GitHub user ID.");
        const userId = userResult.stdout.trim();
        const descString = description ? `description: "${description}", ` : "";
        const mutation = `mutation { createUserList(input: {ownerId: "${userId}", name: "${name}", ${descString}isPublic: true}) { list { name url } } }`;
        const result = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 15000 });
        if (result.code !== 0) {
          if (result.stderr.includes("INSUFFICIENT_SCOPES")) {
            return { isError: true, content: [{ type: "text", text: "Insufficient scopes. Please run `gh auth refresh -s user` in your terminal to grant permission to create lists." }], details: {} };
          }
          if (result.stderr.includes("Name has already been taken")) {
            return { isError: true, content: [{ type: "text", text: `Error: A list named "${name}" already exists.` }], details: {} };
          }
          throw new Error(result.stderr);
        }
        const data = JSON.parse(result.stdout);
        const listUrl = data.data.createUserList.list.url;
        return { content: [{ type: "text", text: `Successfully created star list "${name}".\nView it here: ${listUrl}` }], details: { name, description, url: listUrl } };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "Error creating list: " + (e instanceof Error ? e.message : String(e)) }], details: {} };
      }
    }
  });

  pi.registerTool({
    name: "update_star_list",
    label: "Update Star List",
    description: "Update the name or description of an existing star list.",
    promptSnippet: "Rename a GitHub star list or change its description.",
    promptGuidelines: [
      "Use update_star_list to modify the metadata of an existing list.",
      "You must provide the current name of the list to identify it.",
      "You can provide a new name, a new description, or both."
    ],
    parameters: Type.Object({
      currentName: Type.String({ description: "The current name of the list to update." }),
      newName: Type.Optional(Type.String({ description: "The new name for the list." })),
      newDescription: Type.Optional(Type.String({ description: "The new description for the list." }))
    }),
    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { currentName, newName, newDescription } = params;
      if (!newName && newDescription === undefined) {
        return { isError: true, content: [{ type: "text", text: "Error: You must provide either a new name or a new description." }], details: {} };
      }
      onUpdate?.({ content: [{ type: "text", text: `Updating star list "${currentName}"...` }], details: {} });
      try {
        const listsData = await pi.exec("gh", ["api", "graphql", "-f", "query=query { viewer { lists(first: 100) { nodes { id name } } } }"], { timeout: 10000 });
        if (listsData.code !== 0) throw new Error("Failed to fetch lists: " + listsData.stderr);
        const lists = JSON.parse(listsData.stdout).data.viewer.lists.nodes;
        const targetList = lists.find((l: any) => l.name.toLowerCase() === currentName.toLowerCase());
        if (!targetList) {
          return { isError: true, content: [{ type: "text", text: `List "${currentName}" not found.` }], details: {} };
        }
        const listId = targetList.id;
        let updates = "";
        if (newName) updates += `name: "${newName}", `;
        if (newDescription !== undefined) updates += `description: "${newDescription || ""}", `;
        const mutation = `mutation { updateUserList(input: {listId: "${listId}", ${updates}}) { list { name url } } }`;
        const result = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 15000 });
        if (result.code !== 0) {
          if (result.stderr.includes("INSUFFICIENT_SCOPES")) {
            return { isError: true, content: [{ type: "text", text: "Insufficient scopes. Please run `gh auth refresh -s user` in your terminal to grant permission to update lists." }], details: {} };
          }
          if (result.stderr.includes("Name has already been taken")) {
            return { isError: true, content: [{ type: "text", text: `Error: A list named "${newName}" already exists.` }], details: {} };
          }
          throw new Error(result.stderr);
        }
        const finalName = newName || currentName;
        return { content: [{ type: "text", text: `Successfully updated list. It is now named "${finalName}".` }], details: { oldName: currentName, newName, newDescription } };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "Error updating list: " + (e instanceof Error ? e.message : String(e)) }], details: {} };
      }
    }
  });

  pi.registerTool({
    name: "delete_star_list",
    label: "Delete Star List",
    description: "Deletes a star list. This action is irreversible.",
    promptSnippet: "Delete a GitHub star list.",
    promptGuidelines: [
      "Use delete_star_list to permanently remove a star list.",
      "This action cannot be undone. Use with caution.",
      "By default, it requires confirmation. Use `force: true` to bypass the prompt."
    ],
    parameters: Type.Object({
      name: Type.String({ description: "The name of the list to delete." }),
      force: Type.Optional(Type.Boolean({ description: "If true, bypasses the confirmation prompt. Defaults to false." }))
    }),
    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { name, force = false } = params;
      if (!force) {
        const confirmed = await ctx.ui.confirm("Delete List?", `Are you sure you want to permanently delete the star list "${name}"?`);
        if (!confirmed) {
          return { content: [{ type: "text", text: "Deletion cancelled." }], details: {} };
        }
      }
      onUpdate?.({ content: [{ type: "text", text: `Deleting star list "${name}"...` }], details: {} });
      try {
        const listsData = await pi.exec("gh", ["api", "graphql", "-f", "query=query { viewer { lists(first: 100) { nodes { id name } } } }"], { timeout: 10000 });
        if (listsData.code !== 0) throw new Error("Failed to fetch lists: " + listsData.stderr);
        const lists = JSON.parse(listsData.stdout).data.viewer.lists.nodes;
        const targetList = lists.find((l: any) => l.name.toLowerCase() === name.toLowerCase());
        if (!targetList) {
          return { isError: true, content: [{ type: "text", text: `List "${name}" not found.` }], details: {} };
        }
        const listId = targetList.id;
        const mutation = `mutation { deleteUserList(input: {listId: "${listId}"}) { clientMutationId } }`;
        const result = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 15000 });
        if (result.code !== 0) {
          if (result.stderr.includes("INSUFFICIENT_SCOPES")) {
            return { isError: true, content: [{ type: "text", text: "Insufficient scopes. Please run `gh auth refresh -s user` in your terminal to grant permission to delete lists." }], details: {} };
          }
          throw new Error(result.stderr);
        }
        return { content: [{ type: "text", text: `Successfully deleted star list "${name}".` }], details: { name } };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "Error deleting list: " + (e instanceof Error ? e.message : String(e)) }], details: {} };
      }
    }
  });

  pi.registerTool({
    name: "remove_from_star_list",
    label: "Remove from Star List",
    description: "Remove one or more repositories from a specific star list.",
    promptSnippet: "Remove repositories from a GitHub star list.",
    promptGuidelines: [
      "Use remove_from_star_list when the user wants to remove repos from a list.",
      "The logic is the inverse of adding, and requires care to not remove repos from other lists they belong to."
    ],
    parameters: Type.Object({
      listName: Type.String({ description: "The name of the list from which to remove repos." }),
      repos: Type.Array(Type.String(), { description: "Array of repository full names (owner/repo) to remove." })
    }),
    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { listName, repos } = params;
      if (repos.length === 0) {
        return { content: [{ type: "text", text: "No repositories provided to remove." }], details: {} };
      }
      onUpdate?.({ content: [{ type: "text", text: `Removing ${repos.length} repos from "${listName}"...` }], details: {} });
      try {
        const listsData = await pi.exec("gh", ["api", "graphql", "-f", "query=query { viewer { lists(first: 100) { nodes { id name } } } }"], { timeout: 10000 });
        if (listsData.code !== 0) throw new Error("Failed to fetch lists: " + listsData.stderr);
        const lists = JSON.parse(listsData.stdout).data.viewer.lists.nodes;
        const targetList = lists.find((l: any) => l.name.toLowerCase() === listName.toLowerCase());
        if (!targetList) {
          return { isError: true, content: [{ type: "text", text: `List "${listName}" not found.` }], details: {} };
        }
        const listIdToRemove = targetList.id;
        onUpdate?.({ content: [{ type: "text", text: "Fetching current list assignments to prevent overwriting..." }], details: {} });
        const repoToCurrentLists: Record<string, string[]> = {};
        for (const list of lists) {
          let hasNextPage = true, endCursor: string | null = null;
          while (hasNextPage) {
            const cursorArg = endCursor ? `, after: "${endCursor}"` : "";
            const listQuery = `query { node(id: "${list.id}") { ... on UserList { items(first: 100${cursorArg}) { pageInfo { hasNextPage endCursor } nodes { ... on Repository { nameWithOwner } } } } } }`;
            const res = await pi.exec("gh", ["api", "graphql", "-f", `query=${listQuery}`], { timeout: 15000 });
            if (res.code !== 0) throw new Error(`Failed fetching items for list ${list.name}`);
            const itemsConn = JSON.parse(res.stdout).data.node.items;
            for (const item of itemsConn.nodes) {
              if (item?.nameWithOwner) {
                if (!repoToCurrentLists[item.nameWithOwner]) repoToCurrentLists[item.nameWithOwner] = [];
                repoToCurrentLists[item.nameWithOwner].push(list.id);
              }
            }
            hasNextPage = itemsConn.pageInfo.hasNextPage;
            endCursor = itemsConn.pageInfo.endCursor;
          }
        }
        let successCount = 0; const errors: string[] = [];
        for (let i = 0; i < repos.length; i++) {
          const repo = repos[i];
          onUpdate?.({ content: [{ type: "text", text: `Removing ${repo}... (${i + 1}/${repos.length})` }], details: {} });
          try {
            const repoData = await pi.exec("gh", ["repo", "view", repo, "--json", "id"], { timeout: 10000 });
            if (repoData.code !== 0) throw new Error("Could not find repo ID for " + repo);
            const repoId = JSON.parse(repoData.stdout).id;
            const currentLists = repoToCurrentLists[repo] || [];
            const newListIds = currentLists.filter((id: string) => id !== listIdToRemove);
            const listIdsFormatted = newListIds.map((id: string) => `"${id}"`).join(", ");
            const mutation = `mutation { updateUserListsForItem(input: {itemId: "${repoId}", listIds: [${listIdsFormatted}]}) { clientMutationId } }`;
            const mutRes = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 10000 });
            if (mutRes.code !== 0) throw new Error(mutRes.stderr);
            successCount++;
          } catch (e) {
            errors.push(`${repo}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        let text = `Successfully removed ${successCount} out of ${repos.length} repositories from "${listName}".`;
        if (errors.length > 0) text += `\n\nErrors:\n${errors.map((e: string) => `• ${e}`).join("\n")}`;
        return { content: [{ type: "text", text }], details: { successCount, errors } };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "Error removing from list: " + (e instanceof Error ? e.message : String(e)) }], details: {} };
      }
    }
  });

  pi.registerTool({
    name: "add_to_star_list",
    label: "Add to Star List",
    description: "Add one or more repositories to a specific star list. Requires the 'user' scope on your GitHub token.",
    promptSnippet: "Add repositories to a GitHub star list. Remember to check if the user has the 'user' scope.",
    promptGuidelines: [
      "Use add_to_star_list when the user wants to organize their starred repositories into lists",
      "Explain to the user they may need to run 'gh auth refresh -s user' if they encounter an INSUFFICIENT_SCOPES error",
      "You must provide the exact listName as it appears in list_star_lists"
    ],
    parameters: Type.Object({
      listName: Type.String({ description: "Name of the target star list" }),
      repos: Type.Array(Type.String(), { description: "Array of repository full names (owner/repo)" })
    }),

    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { listName, repos } = params;

      if (repos.length === 0) {
        return { content: [{ type: "text", text: "No repositories provided to add." }], details: {} };
      }

      onUpdate?.({ content: [{ type: "text", text: `Adding ${repos.length} repos to "${listName}"...` }], details: {} });

      try {
        // 1. Get all lists to find the target list ID
        const listsData = await pi.exec("gh", ["api", "graphql", "-f", "query=query { viewer { lists(first: 100) { nodes { id name } } } }"], { timeout: 10000 });
        if (listsData.code !== 0) {
          if (listsData.stderr.includes("INSUFFICIENT_SCOPES")) {
            return { isError: true, content: [{ type: "text", text: "Insufficient scopes. Please run `gh auth refresh -s user` in your terminal to grant permission to modify lists." }], details: {} };
          }
          throw new Error("Failed to fetch lists: " + listsData.stderr);
        }
        
        const lists = JSON.parse(listsData.stdout).data.viewer.lists.nodes;
        const targetList = lists.find((l: any) => l.name.toLowerCase() === listName.toLowerCase());
        
        if (!targetList) {
          return { isError: true, content: [{ type: "text", text: `List "${listName}" not found. Create it on GitHub first.` }], details: {} };
        }
        
        const listId = targetList.id;
        
        // 2. Fetch all user lists and their items to know which lists repos are CURRENTLY in
        // (updateUserListsForItem overrides all lists, so we must append to existing ones)
        onUpdate?.({ content: [{ type: "text", text: "Fetching current list assignments to prevent overwriting..." }], details: {} });
        
        const repoToCurrentLists: Record<string, string[]> = {};
        for (const list of lists) {
          let hasNextPage = true;
          let endCursor = null;
          
          while (hasNextPage) {
            const cursorArg = endCursor ? `, after: "${endCursor}"` : "";
            const listQuery = `query { node(id: "${list.id}") { ... on UserList { items(first: 100${cursorArg}) { pageInfo { hasNextPage endCursor } nodes { ... on Repository { nameWithOwner } } } } } }`;
            
            const res = await pi.exec("gh", ["api", "graphql", "-f", `query=${listQuery}`], { timeout: 15000 });
            if (res.code !== 0) throw new Error(`Failed fetching items for list ${list.name}`);
            
            const itemsConn = JSON.parse(res.stdout).data.node.items;
            for (const item of itemsConn.nodes) {
              if (!item || !item.nameWithOwner) continue;
              if (!repoToCurrentLists[item.nameWithOwner]) repoToCurrentLists[item.nameWithOwner] = [];
              repoToCurrentLists[item.nameWithOwner].push(list.id);
            }
            
            hasNextPage = itemsConn.pageInfo.hasNextPage;
            endCursor = itemsConn.pageInfo.endCursor;
          }
        }

        let successCount = 0;
        let errors = [];

        // 3. Process each repo
        for (let i = 0; i < repos.length; i++) {
          const repo = repos[i];
          onUpdate?.({ content: [{ type: "text", text: `Adding ${repo}... (${i + 1}/${repos.length})` }], details: {} });
          
          try {
            // Get repo ID
            const repoData = await pi.exec("gh", ["repo", "view", repo, "--json", "id"], { timeout: 10000 });
            if (repoData.code !== 0) throw new Error("Could not find repo ID for " + repo);
            const repoId = JSON.parse(repoData.stdout).id;
            
            // Determine combined lists
            const currentLists = repoToCurrentLists[repo] || [];
            const newListIds = Array.from(new Set([...currentLists, listId]));
            const listIdsFormatted = newListIds.map(id => `"${id}"`).join(", ");
            
            // Mutate
            const mutation = `mutation { updateUserListsForItem(input: {itemId: "${repoId}", listIds: [${listIdsFormatted}]}) { clientMutationId } }`;
            const mutRes = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 10000 });
            
            if (mutRes.code !== 0) {
              if (mutRes.stderr.includes("INSUFFICIENT_SCOPES")) {
                throw new Error("Insufficient scopes. Run `gh auth refresh -s user` in your terminal.");
              }
              throw new Error(mutRes.stderr);
            }
            
            successCount++;
          } catch (e) {
            errors.push(`${repo}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        let text = `Successfully added ${successCount} out of ${repos.length} repositories to "${listName}".`;
        if (errors.length > 0) {
          text += `\n\nErrors:\n${errors.map(e => `• ${e}`).join("\n")}`;
        }

        return {
          content: [{ type: "text", text }],
          details: { successCount, errors }
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error adding to list: " + (e instanceof Error ? e.message : String(e)) }],
          details: {}
        };
      }
    }
  });

  // ── COMMAND: /starred ──────────────────────────────────────────

  pi.registerTool({
    name: "analyze_repo",
    label: "Analyze Repository",
    description: "Fetches detailed, structured metadata for a specific GitHub repository. Supports a deep mode that clones and explores the repo like the librarian tool.",
    promptSnippet: "Get detailed information about a repository to understand its purpose, popularity, and technology stack. Use deep:true for code-level analysis.",
    promptGuidelines: [
      "Use analyze_repo to gather data for organizing or making decisions about a repository.",
      "You can specify which fields to fetch to keep the output focused and efficient.",
      "Use deep:true for richer analysis that reads README, package.json, and directory structure.",
      "For multi-repo code search across GitHub, prefer the librarian tool."
    ],
    parameters: Type.Object({
      repo: Type.String({ description: "The full name of the repository (e.g., 'owner/repo')." }),
      fields: Type.Optional(Type.Array(Type.String(), { description: "Specific fields to fetch. Defaults to a comprehensive list." })),
      deep: Type.Optional(Type.Boolean({ description: "If true, clones the repo and performs deep analysis (README, key config files, directory structure). Defaults to false." }))
    }),
    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { repo, fields, deep = false } = params;
      const defaultFields = ["name", "nameWithOwner", "description", "stargazerCount", "forkCount", "pushedAt", "licenseInfo", "languages", "topics", "owner", "url"];
      const fieldsToFetch = fields && fields.length > 0 ? fields : defaultFields;
      onUpdate?.({ content: [{ type: "text", text: `Analyzing repository: ${repo}...` }], details: {} });
      try {
        const result = await pi.exec("gh", ["repo", "view", repo, "--json", fieldsToFetch.join(",")], { timeout: 15000 });
        if (result.code !== 0) {
          throw new Error(`Could not fetch data for repository '${repo}'. Is the name correct?`);
        }
        const repoData = JSON.parse(result.stdout);
        if (repoData.languages) {
          const topLangs = repoData.languages.edges
            .sort((a: any, b: any) => b.size - a.size)
            .slice(0, 3)
            .map((lang: any) => lang.node.name);
          repoData.languages = topLangs;
        }

        if (deep) {
          onUpdate?.({ content: [{ type: "text", text: `Deep analysis: cloning ${repo}...` }], details: {} });
          const tmpDir = `/tmp/gh-my-starred-${repo.replace("/", "-")}-${Date.now()}`;
          const cloneResult = await pi.exec("gh", ["repo", "clone", repo, tmpDir, "--", "--depth", "1"], { timeout: 30000 });
          if (cloneResult.code === 0) {
            const deepData: Record<string, string> = {};
            for (const f of ["README.md", "package.json", "go.mod", "Cargo.toml", "pyproject.toml", "Makefile"]) {
              try {
                const content = await readFile(`${tmpDir}/${f}`, "utf-8");
                deepData[f] = content.slice(0, 2000);
              } catch (_) { /* file doesn't exist */ }
            }
            try {
              const listResult = await pi.exec("ls", ["-la", tmpDir], { timeout: 5000 });
              if (listResult.code === 0) deepData["_directory_listing"] = listResult.stdout.slice(0, 2000);
            } catch (_) { /* ignore */ }
            repoData._deep = deepData;
            await pi.exec("rm", ["-rf", tmpDir], { timeout: 5000 }).catch(() => {});
          }
        }

        return { content: [{ type: "text", text: `Successfully analyzed ${repo}.${deep ? ' Deep analysis included.' : ''} Use the 'details' view to see the structured data.` }], details: { analysis: repoData } };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "Error analyzing repository: " + (e instanceof Error ? e.message : String(e)) }], details: {} };
      }
    }
  });

  pi.registerTool({
    name: "organize_stars_by_language",
    label: "Organize Stars by Language",
    description: "Automatically organizes uncategorized starred repos into language-specific star lists.",
    promptSnippet: "Analyze all starred repositories and automatically file them into lists based on their primary programming language.",
    promptGuidelines: [
      "Use this tool to perform a large-scale, automated organization of your starred repos.",
      "It will create new language lists (e.g., 'Go', 'Rust') as needed.",
      "This can be a long-running operation. Use the `limit` parameter for testing."
    ],
    parameters: Type.Object({
      dryRun: Type.Optional(Type.Boolean({ description: "If true, it will report the changes without performing them. Defaults to false." })),
      limit: Type.Optional(Type.Number({ description: "Process a maximum of this many uncategorized repositories." }))
    }),
    async execute(_toolCallId: string, params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: ((u: {content: any[], details: any}) => void) | undefined, ctx: ExtensionContext) {
      const { dryRun = false, limit } = params;
      onUpdate?.({ content: [{ type: "text", text: `Starting automated organization... ${dryRun ? '(Dry Run)' : ''}` }], details: {} });
      try {
        onUpdate?.({ content: [{ type: "text", text: "Fetching all starred repos and list memberships..." }], details: {} });
        const allRepos = await fetchStarredRepos(pi, signal);
        const allLists = await fetchStarLists(pi, signal);
        const reposInAnyList = new Set<string>();
        for (const list of allLists) {
          const listRepos = await fetchListReposOrdered(pi, list.name, signal);
          listRepos.forEach(repoName => reposInAnyList.add(repoName));
        }
        let uncategorized = allRepos.filter(r => !reposInAnyList.has(r.full_name) && r.language);
        if (limit) uncategorized = uncategorized.slice(0, limit);
        onUpdate?.({ content: [{ type: "text", text: `Found ${uncategorized.length} uncategorized repositories to process.` }], details: {} });
        if (uncategorized.length === 0) {
          return { content: [{ type: "text", text: "All repositories are already organized." }], details: {} };
        }
        const toOrganize = new Map<string, string[]>();
        for (const repo of uncategorized) {
          if (repo.language) {
            const lang = repo.language;
            if (!toOrganize.has(lang)) toOrganize.set(lang, []);
            toOrganize.get(lang)!.push(repo.full_name);
          }
        }
        let changesMade = 0;
        const summary: string[] = [];
        for (const [lang, repos] of toOrganize.entries()) {
          onUpdate?.({ content: [{ type: "text", text: `Processing ${repos.length} repos for language: ${lang}` }], details: {} });
          const listExists = allLists.some(l => l.name.toLowerCase() === lang.toLowerCase());
          if (!listExists) {
            summary.push(`- Would create new list: "${lang}"`);
            if (!dryRun) {
              const userResult = await pi.exec("gh", ["api", "user", "--jq", ".id"], { timeout: 10000 });
              if (userResult.code === 0) {
                const userId = userResult.stdout.trim();
                const mutation = `mutation { createUserList(input: {ownerId: "${userId}", name: "${lang}", description: "Repositories written in ${lang}", isPublic: true}) { list { id name } } }`;
                const createResult = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 15000 });
                if (createResult.code !== 0 && !createResult.stderr.includes("Name has already been taken")) {
                  summary.push(`  - FAILED to create: ${createResult.stderr}`);
                  continue;
                }
              }
            }
          }
          summary.push(`- Would add ${repos.length} repos to "${lang}" list.`);
          if (!dryRun) {
            const listsData = await pi.exec("gh", ["api", "graphql", "-f", "query=query { viewer { lists(first: 100) { nodes { id name } } } }"], { timeout: 10000 });
            if (listsData.code === 0) {
              const lists = JSON.parse(listsData.stdout).data.viewer.lists.nodes;
              const targetList = lists.find((l: any) => l.name.toLowerCase() === lang.toLowerCase());
              if (targetList) {
                const listId = targetList.id;
                for (let i = 0; i < repos.length; i++) {
                  const repo = repos[i];
                  try {
                    const repoData = await pi.exec("gh", ["repo", "view", repo, "--json", "id"], { timeout: 10000 });
                    if (repoData.code !== 0) continue;
                    const repoId = JSON.parse(repoData.stdout).id;
                    const mutation = `mutation { updateUserListsForItem(input: {itemId: "${repoId}", listIds: ["${listId}"]}) { clientMutationId } }`;
                    const mutRes = await pi.exec("gh", ["api", "graphql", "-f", `query=${mutation}`], { timeout: 10000 });
                    if (mutRes.code === 0) changesMade++;
                  } catch (_) { /* skip individual failures */ }
                }
              }
            }
          } else {
            changesMade += repos.length;
          }
        }
        const report = `Organization ${dryRun ? 'Plan' : 'Complete'}:\n- Processed ${uncategorized.length} repositories.\n- ${dryRun ? 'Would add' : 'Added'} ${changesMade} repositories to lists.\n\nSummary:\n${summary.join("\n")}\n`;
        return { content: [{ type: "text", text: report }], details: { plan: summary, changesMade, dryRun } };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "Error during organization: " + (e instanceof Error ? e.message : String(e)) }], details: {} };
      }
    }
  });

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
          ctx.ui.notify("Failed to browse list: " + (e instanceof Error ? e.message : String(e)), "error");
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