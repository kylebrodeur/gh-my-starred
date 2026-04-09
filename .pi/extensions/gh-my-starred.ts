/**
 * gh-my-starred pi Extension
 *
 * Provides a `starred_repos` tool for AI agents to browse and query
 * the user's GitHub starred repositories.
 *
 * Requires: gh cli with authentication
 *           gh-my-starred extension installed: gh extension install kylebrodeur/gh-my-starred
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface StarredRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  html_url: string;
  topics: string[];
  updated_at: string;
}

export default function ghMyStarredExtension(pi: ExtensionAPI) {
  // Register the starred_repos tool
  pi.registerTool({
    name: "starred_repos",
    label: "Starred Repos",
    description: "Browse and query the user's GitHub starred repositories. Returns an array of repository objects that can be filtered by language, topic, or search query.",
    promptSnippet: "Access the user's GitHub starred repositories to find tools, libraries, or reference implementations",
    promptGuidelines: [
      "Use this tool when the user asks about their starred repos or needs to find something they previously starred",
      "Apply filters (language, topic) when the user specifies preferences",
      "Sort by stargazers_count to find popular or notable repos",
      "Use search parameter for fuzzy matching repo names or descriptions"
    ],
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({
        description: "Maximum number of repos to return (default: 100, max: 500)"
      })),
      language: Type.Optional(Type.String({
        description: "Filter by programming language (e.g., 'Go', 'Python', 'TypeScript')"
      })),
      topic: Type.Optional(Type.String({
        description: "Filter by topic tag (e.g., 'cli', 'machine-learning', 'testing')"
      })),
      search: Type.Optional(Type.String({
        description: "Search query to match against full_name or description"
      })),
      minStars: Type.Optional(Type.Number({
        description: "Minimum number of stargazers"
      })),
      sortBy: Type.Optional(Type.String({
        enum: ["stars", "updated", "name"],
        description: "Sort field (default: stars desc)"
      }))
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const limit = Math.min(params.limit ?? 100, 500);
      const { language, topic, search, minStars, sortBy } = params;

      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${limit} starred repositories...` }]
      });

      // Check if gh is available
      try {
        const ghCheck = await pi.exec("gh", ["--version"], { signal, timeout: 5000 });
        if (ghCheck.code !== 0) {
          return {
            content: [{ type: "text", text: "Error: GitHub CLI (gh) is not installed. Install from https://cli.github.com/" }],
            isError: true
          };
        }
      } catch (e) {
        return {
          content: [{ type: "text", text: "Error: GitHub CLI (gh) is not installed or not in PATH" }],
          isError: true
        };
      }

      // Fetch starred repos via gh
      let repos: StarredRepo[];
      try {
        const result = await pi.exec("gh", ["my-starred", "--json", String(limit)], {
          signal,
          timeout: 30000
        });

        if (result.code !== 0) {
          // Try direct gh api fallback
          const fallback = await pi.exec("gh", [
            "api", "--paginate", "user/starred",
            "--jq", "."
          ], { signal, timeout: 30000 });

          if (fallback.code !== 0) {
            return {
              content: [{ type: "text", text: `Error fetching starred repos: ${result.stderr || fallback.stderr}` }],
              isError: true
            };
          }
          repos = JSON.parse(fallback.stdout).slice(0, limit);
        } else {
          repos = JSON.parse(result.stdout);
        }
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true
        };
      }

      if (!Array.isArray(repos) || repos.length === 0) {
        return {
          content: [{ type: "text", text: "No starred repositories found." }],
          details: { repos: [], total: 0, filtered: 0 }
        };
      }

      // Apply filters
      let filtered = repos;

      if (language) {
        const langLower = language.toLowerCase();
        filtered = filtered.filter(r =>
          r.language?.toLowerCase() === langLower
        );
      }

      if (topic) {
        const topicLower = topic.toLowerCase();
        filtered = filtered.filter(r =>
          r.topics?.some(t => t.toLowerCase() === topicLower)
        );
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

      // Sort results
      const sortField = sortBy ?? "stars";
      filtered.sort((a, b) => {
        switch (sortField) {
          case "name":
            return a.full_name.localeCompare(b.full_name);
          case "updated":
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          case "stars":
          default:
            return b.stargazers_count - a.stargazers_count;
        }
      });

      // Format results
      const summary = filtered.slice(0, 20).map(r =>
        `• ${r.full_name} (${r.stargazers_count}⭐)${r.language ? ` [${r.language}]` : ""}${r.description ? ` - ${r.description.slice(0, 100)}${r.description.length > 100 ? "..." : ""}` : ""}`
      ).join("\n");

      return {
        content: [{
          type: "text",
          text: filtered.length === 0
            ? "No repositories match the specified filters."
            : `Found ${filtered.length} repositories${repos.length !== filtered.length ? ` (filtered from ${repos.length} total)` : ""}:\n\n${summary}${filtered.length > 20 ? `\n\n... and ${filtered.length - 20} more` : ""}`
        }],
        details: {
          repos: filtered,
          total: repos.length,
          filtered: filtered.length,
          filters: { language, topic, search, minStars, sortBy }
        }
      };
    }
  });

  // Register a /starred command for interactive browsing
  pi.registerCommand("starred", {
    description: "Browse starred repositories with fzf",
    handler: async (args, ctx) => {
      const limit = args ? parseInt(args, 10) || 100 : 100;

      try {
        // Open interactive mode with gh my-starred
        const result = await pi.exec("gh", ["my-starred", String(limit)], {
          timeout: 0 // No timeout for interactive
        });

        if (result.code !== 0) {
          ctx.ui.notify("Failed to launch interactive browser. Is fzf installed?", "error");
        }
      } catch (e) {
        ctx.ui.notify(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }
  });
}
