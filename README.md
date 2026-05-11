# github-insights-mcp

A learning MCP (Model Context Protocol) server that exposes GitHub repository
insights to Claude Code.

The goal is to use this project as a hands-on way to learn how MCP servers are
structured, registered, and consumed by an MCP client like Claude Code. Over
time it will grow tools that surface useful information about GitHub repos
(activity, contributors, open issues, etc.). Today it ships a single `ping`
tool to verify the wiring end-to-end.

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
