# mcp-phantom-diagrams

An MCP server that converts diagram markup text into images using a locally-managed [Kroki](https://kroki.io/) Docker stack. Supports 28+ diagram types (PlantUML, Mermaid, Graphviz, and more) with SVG, PNG, and JPEG output. Starts the Kroki containers automatically on first use — no manual Docker setup required.

## Tools

| Tool | Description |
|---|---|
| `convert_diagram` | Render diagram markup to SVG, PNG, or JPEG |
| `list_diagram_types` | List all supported diagram types and their available formats |
| `get_kroki_status` | Check Kroki health, version, companion container status, and cache stats |

### `convert_diagram` parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `diagram_type` | string | — | Diagram language (e.g. `plantuml`, `mermaid`, `graphviz`) |
| `source` | string | — | Diagram markup source text |
| `output_format` | `svg` \| `png` \| `jpeg` | `svg` | Output format |
| `output_path` | string | — | Write output to this path instead of returning inline content |
| `options` | object | — | Diagram-type-specific options sent as `Kroki-Diagram-Options-*` headers |
| `query_options` | object | — | Options passed as URL query parameters (e.g. `{ "theme": "dark" }`) |

SVG is returned as a text block. PNG/JPEG are returned as base64 image blocks, or written to disk if `output_path` is set (recommended for large images to avoid token overhead).

## Supported diagram types

**Built-in** (no companion container required): `plantuml`, `graphviz`, `ditaa`, `svgbob`, `umlet`, `erd`, `nomnoml`, `structurizr`, `bytefield`, `c4plantuml`, `d2`, `dbml`, `pikchr`, `symbolator`, `vega`, `vegalite`, `wavedrom`

**Companion containers** (started automatically): `mermaid`, `bpmn`, `excalidraw`, `blockdiag`, `seqdiag`, `actdiag`, `nwdiag`, `packetdiag`, `rackdiag`, `diagramsnet`

## Requirements

- Node.js 20+
- Docker with Compose V2 (`docker compose` command)

## Installation

```bash
npm install
npm run build
```

## Claude Code configuration

Add to your `~/.claude/claude.json` (or project-level `.claude/claude.json`):

```json
{
  "mcpServers": {
    "phantom-diagrams": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-phantom-diagrams/dist/index.js"]
    }
  }
}
```

On first start, the server pulls and starts the Kroki Docker images automatically (shared across all Claude profiles via the `kroki-shared` compose project). Subsequent starts are instant if containers are already running.

## Development

```bash
npm run dev          # watch mode — recompiles on change
npm run test:unit    # unit tests (no Docker required)
npm run test:integration  # round-trip tests (requires Docker)
SKIP_INTEGRATION=1 npm test  # unit tests only, e.g. in CI
```

## Architecture

```
src/
  index.ts    — MCP server, tool registration, startup warm-up
  docker.ts   — container health-check and docker compose up (async, single-flight)
  kroki.ts    — HTTP client for Kroki API, DIAGRAM_TYPES map
  cache.ts    — SHA-256 keyed LRU cache (100 entries / 50 MB)
docker-compose.yml  — kroki + companion containers (project: kroki-shared)
```

The server warms up Kroki before accepting connections so the first tool call is never delayed by container start time. If warm-up fails (Docker not running), it logs a warning and retries on the first tool call.

Rendered results are cached in memory for the lifetime of the server process, keyed on `(diagram_type, source, output_format, options, query_options)`.
