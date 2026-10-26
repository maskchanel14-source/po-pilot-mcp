#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPoPilotServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const SERVER_CARD = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  description:
    "Post-Stocky Shopify replenishment, MOQ/case-pack Purchase Order generator, Stocky CSV supplier recovery, and 3-way supplier invoice reconciliation MCP server.",
  license: "MIT",
  repository: "https://github.com/maskchanel14-source/po-pilot-mcp",
  transports: ["stdio", "streamable-http"],
  authentication: {
    required: false,
    optional_env: ["PO_PILOT_LICENSE_KEY", "SHOPIFY_STORE_DOMAIN", "SHOPIFY_ACCESS_TOKEN"]
  },
  tools: [
    "calculate_replenishment_plan",
    "build_supplier_purchase_orders",
    "reconcile_po_three_way_match",
    "migrate_stocky_csv_snapshot"
  ]
};

async function startHttpServer(port: number): Promise<void> {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url?.split("?")[0] ?? "/";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && (url === "/health" || url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (req.method === "GET" && url === "/.well-known/mcp/server-card.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(SERVER_CARD, null, 2));
      return;
    }

    if (url === "/mcp") {
      try {
        const mcpServer = createPoPilotServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });
        res.on("close", () => {
          void transport.close();
          void mcpServer.close();
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal MCP error" }));
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found. Use /mcp, /health, or /.well-known/mcp/server-card.json" }));
  });

  httpServer.listen(port, "0.0.0.0", () => {
    process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} listening on http://0.0.0.0:${port}/mcp\n`);
  });
}

async function main(): Promise<void> {
  const useHttp = process.argv.includes("--http") || process.env.TRANSPORT === "http";
  if (useHttp) {
    const port = Number(process.env.PORT) || 8080;
    await startHttpServer(port);
    return;
  }

  const server = createPoPilotServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal startup error in ${SERVER_NAME}: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
