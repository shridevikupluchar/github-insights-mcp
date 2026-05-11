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

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

server.registerTool(
  "find_stale_issues",
  {
    description:
      "Finds open GitHub issues that have had no activity (comments or updates) for more than N days. Useful for repo hygiene and triage. Returns issue number, title, days since last activity, and URL.",
    inputSchema: {
      owner: z.string().describe("GitHub username or org name"),
      repo: z.string().describe("Repository name without the owner prefix"),
      days: z
        .number()
        .default(30)
        .describe("Number of days without activity to consider an issue stale"),
    },
  },
  async ({ owner, repo, days }) => {
    try {
      const res = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: "open",
        per_page: 50,
        sort: "updated",
        direction: "asc",
      });

      const stale = res.data
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          staleDays: daysSince(issue.updated_at),
        }))
        .filter((issue) => issue.staleDays >= days)
        .sort((a, b) => b.staleDays - a.staleDays);

      if (stale.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No stale issues found — repo is well maintained!",
            },
          ],
        };
      }

      const body = stale
        .map(
          (i) =>
            `#${i.number} - ${i.title} (stale for ${i.staleDays} days)\nURL: ${i.url}`,
        )
        .join("\n\n");

      const text = [
        `Stale issues in ${owner}/${repo} (no activity for >${days} days):`,
        "",
        body,
        "",
        `Total: ${stale.length} stale issues found.`,
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

server.registerTool(
  "summarize_recent_commits",
  {
    description:
      "Returns a list of commits made to the default branch in the last N days, including author, date, and commit message. Useful for understanding what changed recently or generating a changelog. Use this when asked 'what shipped this week' or 'what changed recently'.",
    inputSchema: {
      owner: z.string().describe("GitHub username or org name"),
      repo: z.string().describe("Repository name without the owner prefix"),
      days: z
        .number()
        .default(7)
        .describe("How many days back to look for commits"),
    },
  },
  async ({ owner, repo, days }) => {
    try {
      const since = new Date(Date.now() - days * MS_PER_DAY);
      const res = await octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 50,
        since: since.toISOString(),
      });

      if (res.data.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No commits found in the last ${days} days.`,
            },
          ],
        };
      }

      const entries = res.data.map((c) => {
        const date =
          c.commit.author?.date?.slice(0, 10) ??
          c.commit.committer?.date?.slice(0, 10) ??
          "unknown";
        const author =
          c.author?.login ?? c.commit.author?.name ?? "unknown";
        const firstLine = c.commit.message.split("\n")[0] ?? "";
        return `${date} | ${author}\n${firstLine}`;
      });

      const text = [
        `Commits in ${owner}/${repo} in the last ${days} days (${res.data.length} total):`,
        "",
        entries.join("\n\n"),
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

server.registerTool(
  "get_pr_review_load",
  {
    description:
      "Lists all open pull requests sorted by age (oldest first), including title, author, how many days it has been open, number of review comments, and URL. Use this to understand PR backlog and review bottlenecks.",
    inputSchema: {
      owner: z.string().describe("GitHub username or org name"),
      repo: z.string().describe("Repository name without the owner prefix"),
    },
  },
  async ({ owner, repo }) => {
    try {
      const prsRes = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        per_page: 50,
        sort: "created",
        direction: "asc",
      });

      if (prsRes.data.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No open pull requests — backlog is clear!",
            },
          ],
        };
      }

      const reviewCommentResults = await Promise.all(
        prsRes.data.map((pr) =>
          octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 1,
          }),
        ),
      );

      const enriched = prsRes.data.map((pr, i) => {
        const linkHeader = reviewCommentResults[i]?.headers.link ?? "";
        const lastPageMatch = linkHeader.match(
          /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/,
        );
        const reviewComments = lastPageMatch
          ? Number(lastPageMatch[1])
          : reviewCommentResults[i]?.data.length ?? 0;
        return {
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? "unknown",
          daysOpen: daysSince(pr.created_at),
          reviewComments,
          url: pr.html_url,
        };
      });

      const body = enriched
        .map(
          (p) =>
            `#${p.number} - ${p.title}\nAuthor: ${p.author} | Open for: ${p.daysOpen} days | Review comments: ${p.reviewComments}\nURL: ${p.url}`,
        )
        .join("\n\n");

      const avgAge = Math.round(
        enriched.reduce((sum, p) => sum + p.daysOpen, 0) / enriched.length,
      );

      const text = [
        `Open PRs in ${owner}/${repo} (oldest first):`,
        "",
        body,
        "",
        `Total: ${enriched.length} open PRs`,
        `Average age: ${avgAge} days`,
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
