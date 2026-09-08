# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@neverprepared/mcp-kroki` is a TypeScript MCP server (stdio transport) that renders diagram
markup to images via [Kroki](https://kroki.io/). It targets a reachable Kroki endpoint
(`KROKI_URL`, default `http://localhost:18000`) and, only as a fallback, auto-starts a local
Kroki Docker stack.

Distribution is **Homebrew-only** — a single self-contained binary compiled with
`bun build --compile`. There is no npm publish; `package.json` is for development and CI.

## Commands

```bash
npm install                  # install dependencies
npm run build                # tsc → dist/ (postbuild chmod +x dist/index.js)
npm run dev                  # tsc --watch
npm run typecheck            # tsc --noEmit
npm run test:unit            # unit tests — no Docker required
npm run test:integration     # round-trip tests — requires Docker/Kroki
npm test                     # all tests (SKIP_INTEGRATION=1 to skip integration)
npm start                    # node dist/index.js (stdio MCP server)
```

Tests use the built-in `node:test` runner via `tsx/esm`; they import `../src/*.ts` directly,
so no build step is needed to run them.

**There is no linter configured** (no ESLint/Prettier/Biome). `npm run typecheck` is the
static-analysis gate — run it before committing.

## CI / release

- `.github/workflows/ci.yml` — on push/PR to `main`: `npm ci` → `typecheck` → `test:unit` →
  `build`. Integration tests are deliberately skipped in CI (no Docker).
- `.github/workflows/release.yaml` — on `v*` tags (or `workflow_dispatch`): runs on
  `macos-14`, `bun install` (not `--frozen-lockfile` — bun migrates `package-lock.json`),
  compiles `bun-darwin-arm64` + `bun-linux-arm64` + `bun-linux-x64` binaries, publishes a
  GitHub release, and renders `Formula/mcp-kroki.rb` into `neverprepared/homebrew-tap`
  (skipped when `HOMEBREW_TAP_TOKEN` is unset). Linux binaries exist so the mcp-gateway
  container image can bake them (mcp-kroki isn't on npm, so it can't be `npx`'d).

## Architecture

| File | Role |
|---|---|
| `src/index.ts` | MCP server entry: registers the three tools, startup warm-up, `StdioServerTransport` |
| `src/docker.ts` | `KROKI_URL`, `ensureKrokiRunning()` — health check + `docker compose up -d` fallback |
| `src/kroki.ts` | `convertDiagram()` HTTP client, `DIAGRAM_TYPES` static map, input/response validation |
| `src/cache.ts` | `diagramCache` — SHA-256-keyed in-memory LRU (100 entries / 50 MB) |
| `docker-compose.yml` | Reference copy of the Kroki stack (project `kroki-shared`) |
| `test/unit.test.ts` | Pure unit tests (types map, cache, option validation) |
| `test/integration.test.ts` | Round-trips against a live Kroki; skipped with `SKIP_INTEGRATION=1` |

### MCP tools exposed

- **`convert_diagram`** — render `source` of `diagram_type` to `svg`/`png`/`jpeg`. Optional
  `output_path` (writes the file, creating parent dirs, and returns path + size instead of
  inline content), `options` (sent as `Kroki-Diagram-Options-*` headers), `query_options`
  (URL query params). Rejects a format the diagram type doesn't support. Results are cached.
- **`list_diagram_types`** — JSON list of every type with its `formats` and `requiresCompanion`.
- **`get_kroki_status`** — Kroki URL/health/version info, the list of companion-requiring
  types, and cache stats (`entries`, `bytes`).

Tool annotations are set: `convert_diagram` is `readOnlyHint: false` (it can write files);
the other two are read-only. All three are `openWorldHint: false`.

### Kroki lifecycle (`src/docker.ts`)

The compose YAML is **embedded as a string constant in `src/docker.ts`**, not read from the
sibling `docker-compose.yml` — the compiled single-file binary has no files next to it. It is
materialized to `$TMPDIR/kroki-shared/docker-compose.yml` only when the fallback start runs.
Keep the root `docker-compose.yml` and `COMPOSE_YAML` in sync when either changes.

1. `GET $KROKI_URL/health` — healthy only if the JSON body is `{"status":"pass"}` (guards
   against unrelated services answering on the port).
2. Otherwise `docker compose -p kroki-shared -f <tmp>/docker-compose.yml up -d`, spawned with
   argv (no shell), 5-minute timeout to allow first-run image pulls.
3. Poll health with exponential backoff (500 ms → 2 s, 30 s deadline).

A single-flight latch (`startingPromise`) means concurrent callers share one start attempt.
`src/index.ts` calls `ensureKrokiRunning()` at startup so the first tool call doesn't absorb
cold-start latency; a failure there is logged to stderr and retried on first use.

Kroki binds `127.0.0.1:18000` → container `8000`.

### Conventions

- **Output blocks**: `svg` → `text` content block; `png`/`jpeg` → base64 `image` block —
  unless `output_path` is set, in which case a short confirmation string is returned.
- **Security limits** (`src/kroki.ts`): source ≤ 256 KB, response ≤ 10 MB, 30 s fetch timeout,
  response `content-type` must match the requested format, and option keys/values are
  allowlisted (`/^[A-Za-z0-9_-]{1,64}$/`, printable ASCII ≤ 1024) to prevent CRLF header
  injection. Preserve these checks when touching that file.
- **Zod v4** (bundled with `@modelcontextprotocol/sdk` ≥ 1.29): `z.record()` requires both key
  and value types — `z.record(z.string(), z.string())`.
- **ESM + NodeNext**: relative imports in `src/` must carry the `.js` extension.
- Adding a diagram type means updating `DIAGRAM_TYPES` (and the companion container in both
  compose definitions if it needs one) plus a unit test.
- `CLAUDE.md` is un-ignored in `.gitignore` (`!CLAUDE.md`) to override a global gitignore;
  it may still need `git add -f`.
