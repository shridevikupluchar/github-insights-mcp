#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

if (!process.env.GITHUB_TOKEN) {
  console.error("Error: GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const server = new McpServer({
  name: "github-insights",
  version: "0.1.0",
});

server.registerTool(
  "ping",
  {
    description: "Health-check tool that echoes back the message you send.",
    inputSchema: {
      message: z.string().describe("The message to echo back."),
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong: ${message}` }],
  }),
);

server.registerTool(
  "get_repo_stats",
  {
    description:
      "Fetches key statistics for a GitHub repository: description, primary language, stars, forks, open issues count, open PR count, last commit date, and top 5 contributors by commit count. Use this when the user asks about a repo's activity, health, or contributor breakdown. Works on any public repo, or private repos the token can access.",
    inputSchema: {
      owner: z.string().describe("GitHub username or org name"),
      repo: z.string().describe("Repository name without the owner prefix"),
    },
  },
  async ({ owner, repo }) => {
    try {
      const [repoRes, contributorsRes, commitsRes, pullsRes] = await Promise.all([
        octokit.rest.repos.get({ owner, repo }),
        octokit.rest.repos.listContributors({ owner, repo, per_page: 5 }),
        octokit.rest.repos.listCommits({ owner, repo, per_page: 1 }),
        octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 1 }),
      ]);

      const data = repoRes.data;
      const description = data.description ?? "None";
      const language = data.language ?? "Not specified";
      const stars = data.stargazers_count;
      const forks = data.forks_count;
      const openIssuesAndPrs = data.open_issues_count;

      // GitHub's "open_issues_count" includes PRs. Get the real open-PR count from the pulls API.
      // The pulls API only returned 1 row for sampling; use the Link header total when available,
      // otherwise fall back to subtracting from open_issues_count.
      const linkHeader = pullsRes.headers.link ?? "";
      const lastPageMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
      const openPrCount = lastPageMatch
        ? Number(lastPageMatch[1])
        : pullsRes.data.length;
      const openIssueCount = Math.max(0, openIssuesAndPrs - openPrCount);

      const lastCommit = commitsRes.data[0];
      const lastCommitDate =
        lastCommit?.commit.author?.date ??
        lastCommit?.commit.committer?.date ??
        "unknown";

      const topContributors =
        contributorsRes.data
          .map((c) => `${c.login ?? "unknown"} (${c.contributions} commits)`)
          .join(", ") || "none";

      const text = [
        `Repository: ${owner}/${repo}`,
        `Description: ${description}`,
        `Language: ${language}`,
        `Stars: ${stars} | Forks: ${forks} | Open Issues: ${openIssueCount} | Open PRs: ${openPrCount}`,
        `Last commit: ${lastCommitDate}`,
        `Top contributors: ${topContributors}`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Repository not found or token doesn't have access: ${owner}/${repo}`,
            },
          ],
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `GitHub API error: ${message}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-insights MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting github-insights MCP server:", err);
  process.exit(1);
});
