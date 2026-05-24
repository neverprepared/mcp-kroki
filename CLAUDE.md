# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm run build     # compile TypeScript → dist/
npm start         # run the MCP server (stdio transport)
npm run dev       # watch mode — recompiles on change
```

No tests are configured yet. Verify manually via `npx @modelcontextprotocol/inspector node dist/index.js`.

## Architecture

This is a TypeScript MCP server (stdio transport) that wraps [Kroki](https://kroki.io/) — a unified diagram-rendering gateway. Kroki runs as a local Docker stack; the server auto-starts it on first tool call if it isn't already up.

### File map

| File | Role |
|---|---|
| `src/index.ts` | MCP server entry: registers tools, connects `StdioServerTransport` |
| `src/docker.ts` | `ensureKrokiRunning()` — health-checks Kroki and runs `docker compose up -d` if needed |
| `src/kroki.ts` | `convertDiagram()` HTTP client + `DIAGRAM_TYPES` static map |
| `docker-compose.yml` | Kroki + companion containers; project name `kroki-shared` (shared across profiles) |

### MCP tools exposed

- **`convert_diagram`** — POST diagram source text to Kroki, return SVG string or base64 PNG/JPEG
- **`list_diagram_types`** — return static map of supported types and their output formats

### Container startup flow

1. `GET localhost:8000/health` → already up, done
2. Else: `docker compose -p kroki-shared -f <abs-path>/docker-compose.yml up -d`
3. Poll health with exponential backoff (max 30 s)

Port is configurable via `KROKI_URL` env var (default `http://localhost:8000`).

### Output format handling

- `svg` → returned as a `text` content block (plain SVG string)
- `png` / `jpeg` → returned as an `image` content block (base64-encoded)

### Zod version

The project uses Zod v4 (bundled with `@modelcontextprotocol/sdk` 1.29+). Use `z.record(z.string(), z.string())` — Zod v4 requires both key and value type arguments.
