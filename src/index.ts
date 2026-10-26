#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPoPilotServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const SERVER_CARD = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  description:
    "Post-Stocky Shopify replenishment, Open-to-Buy & landed-cost MOQ Purchase Orders, POS Transfer CSVs, Stocky CSV recovery, and 3-way invoice match with QuickBooks/Xero Bill CSVs.",
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

async function startStdio(): Promise<void> {
  const server = createPoPilotServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttpServer(port: number): Promise<void> {
  const serverCardPayload = JSON.stringify(SERVER_CARD, null, 2);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, X-PO-Pilot-Key"
      );

      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }

      const url = (req.url ?? "/").split("?")[0];
      const isGetOrHead = req.method === "GET" || req.method === "HEAD";

      if (isGetOrHead && (url === "/health" || url === "/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(
          JSON.stringify({
            status: "ok",
            server: SERVER_NAME,
            name: SERVER_NAME,
            version: SERVER_VERSION,
            transport: "streamable-http",
            mcp_endpoint: "/mcp"
          })
        );
        return;
      }

      if (isGetOrHead && url === "/.well-known/mcp/server-card.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(serverCardPayload);
        return;
      }

      if (url === "/mcp") {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Use POST /mcp for stateless MCP calls." },
              id: null
            })
          );
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB safety cap
        for await (const chunk of req) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > MAX_BODY_BYTES) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload too large (max 10MB)" }));
            return;
          }
          chunks.push(buf);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let parsedBody: unknown;
        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Invalid JSON body" }, id: null }));
          return;
        }

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
        await transport.handleRequest(req, res, parsedBody);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found. Use /mcp, /health, or /.well-known/mcp/server-card.json" }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal MCP error" }));
      }
    }
  });

  const shutdown = (): void => {
    httpServer.close(() => {
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await new Promise<void>((resolve) => {
    httpServer.listen(port, "0.0.0.0", () => {
      process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} listening on http://0.0.0.0:${port}/mcp\n`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useHttp =
    args.includes("--http") || process.env.TRANSPORT === "http" || process.env.MCP_TRANSPORT === "http";
  if (useHttp) {
    const parsedPort = Number(process.env.PORT);
    const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 8080;
    await startHttpServer(port);
    return;
  }

  await startStdio();
}

main().catch((err) => {
  process.stderr.write(`Fatal startup error in ${SERVER_NAME}: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
