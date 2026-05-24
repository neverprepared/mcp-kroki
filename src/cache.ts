import { createHash } from "crypto";
import type { ConvertResult } from "./kroki.js";

const MAX_ENTRIES = 100;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

interface Entry {
  result: ConvertResult;
  bytes: number;
}

function resultBytes(result: ConvertResult): number {
  return result.format === "svg"
    ? Buffer.byteLength(result.data as string, "utf8")
    : (result.data as Buffer).byteLength;
}

class DiagramCache {
  // Map preserves insertion order; delete+reinsert moves entry to "most recent" end.
  private readonly store = new Map<string, Entry>();
  private totalBytes = 0;

  cacheKey(
    diagramType: string,
    source: string,
    outputFormat: string,
    options?: Record<string, string>,
    queryOptions?: Record<string, string>
  ): string {
    return createHash("sha256")
      .update(JSON.stringify([diagramType, source, outputFormat, options ?? {}, queryOptions ?? {}]))
      .digest("hex");
  }

  get(key: string): ConvertResult | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.result;
  }

  set(key: string, result: ConvertResult): void {
    const bytes = resultBytes(result);

    while (
      this.store.size >= MAX_ENTRIES ||
      (this.totalBytes + bytes > MAX_BYTES && this.store.size > 0)
    ) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.totalBytes -= this.store.get(oldest)!.bytes;
      this.store.delete(oldest);
    }

    this.store.set(key, { result, bytes });
    this.totalBytes += bytes;
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.store.size, bytes: this.totalBytes };
  }
}

export const diagramCache = new DiagramCache();
