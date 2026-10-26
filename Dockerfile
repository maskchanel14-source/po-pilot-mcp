# syntax=docker/dockerfile:1
# Multi-stage hardened Node 22 Alpine image (deployment-patterns & docker-patterns)
# Supports BOTH:
#   1. Default stdio MCP mode (Glama, Smithery, Docker MCP Toolkit, Claude Desktop)
#   2. Streamable HTTP MCP mode for n8n / Cloud when env TRANSPORT=http (listens on 0.0.0.0:8080)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001 -G mcp

COPY --from=builder --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /app/dist ./dist
COPY --from=builder --chown=mcp:mcp /app/package.json ./package.json

USER mcp
ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD sh -c 'if [ "$TRANSPORT" = "http" ]; then wget -qO- "http://127.0.0.1:${PORT:-8080}/health" >/dev/null || exit 1; else exit 0; fi'

CMD ["node", "dist/index.js"]
