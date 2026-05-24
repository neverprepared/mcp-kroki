import { KROKI_URL } from "./docker.js";

export type OutputFormat = "svg" | "png" | "jpeg";

export interface DiagramTypeInfo {
  formats: OutputFormat[];
  requiresCompanion: boolean;
}

export const DIAGRAM_TYPES = {
  // Built-in (no companion container required)
  plantuml:     { formats: ["svg", "png", "jpeg"] as OutputFormat[], requiresCompanion: false },
  graphviz:     { formats: ["svg", "png", "jpeg"] as OutputFormat[], requiresCompanion: false },
  ditaa:        { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  svgbob:       { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  umlet:        { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  erd:          { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  nomnoml:      { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  structurizr:  { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  bytefield:    { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  c4plantuml:   { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  d2:           { formats: ["svg"]                 as OutputFormat[], requiresCompanion: false },
  dbml:         { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  pikchr:       { formats: ["svg"]                 as OutputFormat[], requiresCompanion: false },
  symbolator:   { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  vega:         { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  vegalite:     { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },
  wavedrom:     { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: false },

  // Companion containers required
  mermaid:      { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  bpmn:         { formats: ["svg"]                 as OutputFormat[], requiresCompanion: true },
  excalidraw:   { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  blockdiag:    { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  seqdiag:      { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  actdiag:      { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  nwdiag:       { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  packetdiag:   { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  rackdiag:     { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
  diagramsnet:  { formats: ["svg", "png"]          as OutputFormat[], requiresCompanion: true },
} satisfies Record<string, DiagramTypeInfo>;

export type DiagramType = keyof typeof DIAGRAM_TYPES;

const MAX_SOURCE_BYTES = 256 * 1024;       // 256 KB
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

// Allowlist for Kroki-Diagram-Options-* header keys and values to prevent CRLF injection.
const OPTION_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPTION_VAL_RE = /^[\x20-\x7E]{0,1024}$/;

export type ConvertResult =
  | { format: "svg"; data: string }
  | { format: "png" | "jpeg"; data: Buffer };

export async function convertDiagram(
  diagramType: DiagramType,
  source: string,
  outputFormat: OutputFormat,
  options?: Record<string, string>,
  queryOptions?: Record<string, string>
): Promise<ConvertResult> {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error(`Diagram source exceeds ${MAX_SOURCE_BYTES / 1024} KB limit`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    Accept: outputFormat === "svg" ? "image/svg+xml" : `image/${outputFormat}`,
  };

  if (options) {
    for (const [key, value] of Object.entries(options)) {
      if (!OPTION_KEY_RE.test(key)) {
        throw new Error(`Invalid option key: ${JSON.stringify(key)}`);
      }
      if (!OPTION_VAL_RE.test(value)) {
        throw new Error(`Invalid option value for key ${JSON.stringify(key)}`);
      }
      headers[`Kroki-Diagram-Options-${key}`] = value;
    }
  }

  const url = new URL(`${KROKI_URL}/${diagramType}/${outputFormat}`);
  if (queryOptions) {
    for (const [key, value] of Object.entries(queryOptions)) {
      if (!OPTION_KEY_RE.test(key)) {
        throw new Error(`Invalid query option key: ${JSON.stringify(key)}`);
      }
      if (!OPTION_VAL_RE.test(value)) {
        throw new Error(`Invalid query option value for key ${JSON.stringify(key)}`);
      }
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: source,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status >= 400 && res.status < 500
      ? `Diagram source rejected — likely a syntax error in the ${diagramType} source. `
      : "Kroki server error. ";
    throw new Error(`${hint}HTTP ${res.status}: ${body}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const expectedMime = outputFormat === "svg" ? "image/svg+xml" : `image/${outputFormat}`;
  if (!contentType.includes(expectedMime)) {
    throw new Error(
      `Unexpected content-type from Kroki: "${contentType}" (expected "${expectedMime}")`
    );
  }

  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      `Kroki response too large: ${contentLength} bytes (limit ${MAX_RESPONSE_BYTES / 1024 / 1024} MB)`
    );
  }

  if (outputFormat === "svg") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Kroki SVG response exceeds size limit");
    }
    return { format: "svg", data: text };
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Kroki image response exceeds size limit");
  }
  return { format: outputFormat, data: Buffer.from(arrayBuffer) };
}
