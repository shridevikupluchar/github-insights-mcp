#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-insights MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting github-insights MCP server:", err);
  process.exit(1);
});
