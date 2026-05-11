# github-insights-mcp

A learning MCP (Model Context Protocol) server that exposes GitHub repository
insights to Claude Code.

The goal is to use this project as a hands-on way to learn how MCP servers are
structured, registered, and consumed by an MCP client like Claude Code. It
surfaces useful information about GitHub repos — activity, contributors, open
issues, PR backlog — as MCP tools the client can call.

## Configuration

Copy `.env.example` to `.env` and set `GITHUB_TOKEN` to a GitHub personal
access token with read access to the repos you want to query. The server
refuses to start without it.

## Tools

- **`ping`** — health-check that echoes a message back. Verifies the server is
  reachable and the protocol is wired up.
  _Example:_ "ping the github-insights server with 'hello'"
- **`get_repo_stats`** — description, language, stars, forks, open issue/PR
  counts, last commit date, and top 5 contributors for a repo.
  _Example:_ "How active is facebook/react?"
- **`find_stale_issues`** — open issues with no activity for more than N days
  (default 30). Filters out PRs. Sorted most-stale first.
  _Example:_ "Which issues in nodejs/node have been ignored for 60+ days?"
- **`summarize_recent_commits`** — commits on the default branch in the last
  N days (default 7), with author, date, and subject line.
  _Example:_ "What shipped in vercel/next.js this week?"
- **`get_pr_review_load`** — open PRs sorted oldest-first, with author, age,
  and review-comment count, plus an average age across the backlog.
  _Example:_ "Show me the PR review backlog for tailwindlabs/tailwindcss."

## Scripts

- `npm run build` — compile TypeScript to `./build`
- `npm run dev` — run the server directly with `tsx` (no build step)

## Running the server

After building, the server speaks MCP over stdio:

```sh
node ./build/index.js
```

It is intended to be launched by an MCP client (e.g. Claude Code), not invoked
manually — clients connect to its stdin/stdout to send protocol messages.
