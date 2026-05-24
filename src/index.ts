#!/usr/bin/env node
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ensureKrokiRunning, KROKI_URL } from "./docker.js";
import { convertDiagram, DIAGRAM_TYPES, type DiagramType, type OutputFormat } from "./kroki.js";
import { diagramCache } from "./cache.js";

const server = new McpServer({
  name: "phantom-diagrams",
  version: "1.0.0",
});

const diagramTypeEnum = Object.keys(DIAGRAM_TYPES) as [DiagramType, ...DiagramType[]];

server.registerTool(
  "convert_diagram",
  {
    title: "Convert diagram source to image",
    description:
      "Render a diagram from source text using a local Kroki instance. " +
      "SVG output is returned as a text block; PNG and JPEG as base64 image blocks — or written to disk if output_path is provided. " +
      "Results are cached in memory; identical inputs return instantly. " +
      "Call list_diagram_types first to see which types support which formats. " +
      "If Kroki returns an HTTP 4xx error, the diagram source likely has a syntax error — fix it and retry.",
    inputSchema: {
      diagram_type: z
        .enum(diagramTypeEnum)
        .describe("Diagram language/type — e.g. plantuml, mermaid, graphviz. Call list_diagram_types to see all options."),
      source: z
        .string()
        .min(1)
        .max(256 * 1024)
        .describe("Diagram markup source text"),
      output_format: z
        .enum(["svg", "png", "jpeg"])
        .default("svg")
        .describe("Output format. SVG is returned as text; PNG and JPEG as base64-encoded image blocks (or written to disk if output_path is set)."),
      output_path: z
        .string()
        .optional()
        .describe("Absolute or relative path to write the output file to. Parent directories are created automatically. When set, returns the path and file size instead of raw content — preferred for PNG/JPEG to avoid large base64 payloads."),
      options: z
        .record(z.string(), z.string())
        .optional()
        .describe("Diagram-type-specific rendering options sent as Kroki-Diagram-Options-* HTTP headers (see Kroki docs). Keys and values must be printable ASCII."),
      query_options: z
        .record(z.string(), z.string())
        .optional()
        .describe("Diagram-type-specific options passed as URL query parameters (e.g. { theme: 'dark' }). Keys and values must be printable ASCII."),
    },
    annotations: {
      readOnlyHint: false, // can write files when output_path is set
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ diagram_type, source, output_format, output_path, options, query_options }) => {
    await ensureKrokiRunning();

    const typeInfo = DIAGRAM_TYPES[diagram_type as DiagramType];
    if (!typeInfo.formats.includes(output_format as OutputFormat)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `${diagram_type} does not support ${output_format}. Supported formats: ${typeInfo.formats.join(", ")}`,
          },
        ],
      };
    }

    const cacheKey = diagramCache.cacheKey(diagram_type, source, output_format, options, query_options);
    let result = diagramCache.get(cacheKey);

    if (!result) {
      result = await convertDiagram(
        diagram_type as DiagramType,
        source,
        output_format as OutputFormat,
        options,
        query_options
      );
      diagramCache.set(cacheKey, result);
    }

    if (output_path) {
      const absPath = resolve(output_path);
      await mkdir(dirname(absPath), { recursive: true });
      const content = result.format === "svg" ? result.data : result.data;
      await writeFile(absPath, content);
      const bytes =
        result.format === "svg"
          ? Buffer.byteLength(result.data as string, "utf8")
          : (result.data as Buffer).byteLength;
      return {
        content: [
          {
            type: "text" as const,
            text: `Written to ${absPath} (${(bytes / 1024).toFixed(1)} KB)`,
          },
        ],
      };
    }

    if (result.format === "svg") {
      return { content: [{ type: "text" as const, text: result.data }] };
    }

    return {
      content: [
        {
          type: "image" as const,
          data: result.data.toString("base64"),
          mimeType: `image/${result.format}` as "image/png" | "image/jpeg",
        },
      ],
    };
  }
);

server.registerTool(
  "list_diagram_types",
  {
    title: "List supported diagram types",
    description:
      "Returns all diagram types Kroki supports along with their available output formats and whether they require a companion container. " +
      "Call this before convert_diagram if you are unsure which type or format to use.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const rows = Object.entries(DIAGRAM_TYPES).map(([type, info]) => ({
      type,
      formats: info.formats,
      requiresCompanion: info.requiresCompanion,
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
    };
  }
);

server.registerTool(
  "get_kroki_status",
  {
    title: "Get Kroki server status",
    description:
      "Returns the health and version of the local Kroki instance, which diagram types require companion containers, and current render cache stats. " +
      "Useful for diagnosing why a diagram type is failing or checking what is running.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    let healthy = false;
    let krokiInfo: unknown = null;

    try {
      const res = await fetch(`${KROKI_URL}/health`, { signal: AbortSignal.timeout(3_000) });
      healthy = res.ok;
      if (res.ok) {
        krokiInfo = await res.json().catch(() => null);
      }
    } catch {
      // healthy stays false
    }

    const companions = Object.entries(DIAGRAM_TYPES)
      .filter(([, info]) => info.requiresCompanion)
      .map(([type]) => type);

    const status = {
      kroki: {
        url: KROKI_URL,
        healthy,
        ...(krokiInfo ? { info: krokiInfo } : {}),
      },
      companions,
      cache: diagramCache.stats(),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
    };
  }
);

// Warm up Kroki before accepting requests so the first tool call doesn't
// absorb the container start latency (can be 30s+ on cold pull).
await ensureKrokiRunning().catch((err: Error) => {
  console.error(`[phantom-diagrams] Kroki warm-up failed: ${err.message}. Will retry on first tool call.`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
