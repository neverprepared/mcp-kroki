import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DIAGRAM_TYPES, convertDiagram } from "../src/kroki.ts";
import { diagramCache } from "../src/cache.ts";

describe("DIAGRAM_TYPES map", () => {
  test("every type has at least one format", () => {
    for (const [type, info] of Object.entries(DIAGRAM_TYPES)) {
      assert.ok(info.formats.length > 0, `${type} has no formats`);
    }
  });

  test("svg is supported by every built-in type", () => {
    for (const [type, info] of Object.entries(DIAGRAM_TYPES)) {
      if (!info.requiresCompanion) {
        assert.ok(info.formats.includes("svg"), `built-in type ${type} should support svg`);
      }
    }
  });

  test("mermaid supports png (companion fix)", () => {
    assert.ok(DIAGRAM_TYPES.mermaid.formats.includes("png"));
  });

  test("dbml supports png", () => {
    assert.ok(DIAGRAM_TYPES.dbml.formats.includes("png"));
  });

  test("blockdiag-family types all marked requiresCompanion", () => {
    for (const t of ["seqdiag", "actdiag", "nwdiag", "packetdiag", "rackdiag"] as const) {
      assert.ok(DIAGRAM_TYPES[t].requiresCompanion, `${t} should require companion`);
    }
  });
});

describe("convertDiagram input validation", () => {
  test("rejects source exceeding 256 KB", async () => {
    const bigSource = "x".repeat(256 * 1024 + 1);
    await assert.rejects(
      () => convertDiagram("plantuml", bigSource, "svg"),
      /exceeds.*limit/i
    );
  });

  test("rejects CRLF in option key", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "@startuml\n@enduml", "svg", { "bad\r\nkey": "val" }),
      /Invalid option key/
    );
  });

  test("rejects CRLF in option value", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "@startuml\n@enduml", "svg", { key: "bad\r\nvalue" }),
      /Invalid option value/
    );
  });

  test("rejects non-printable chars in option key", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "@startuml\n@enduml", "svg", { "key\x00null": "val" }),
      /Invalid option key/
    );
  });

  test("rejects non-printable chars in option value", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "@startuml\n@enduml", "svg", { key: "val\x00null" }),
      /Invalid option value/
    );
  });

  test("rejects CRLF in query option key", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "@startuml\n@enduml", "svg", undefined, { "bad\r\nkey": "val" }),
      /Invalid query option key/
    );
  });

  test("rejects CRLF in query option value", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "@startuml\n@enduml", "svg", undefined, { key: "bad\r\nval" }),
      /Invalid query option value/
    );
  });
});

describe("DiagramCache", () => {
  test("miss returns undefined", () => {
    const key = diagramCache.cacheKey("plantuml", "source", "svg");
    // Use a fresh key unlikely to exist
    assert.equal(diagramCache.get("no-such-key-" + Math.random()), undefined);
  });

  test("set then get returns same result", () => {
    const result = { format: "svg" as const, data: "<svg/>" };
    const key = diagramCache.cacheKey("graphviz", "digraph{}", "svg");
    diagramCache.set(key, result);
    const hit = diagramCache.get(key);
    assert.deepEqual(hit, result);
  });

  test("stats reflect cached entries", () => {
    const before = diagramCache.stats();
    const result = { format: "svg" as const, data: "<svg>hello</svg>" };
    const key = diagramCache.cacheKey("nomnoml", "#direction: right", "svg", {}, { theme: "dark" });
    diagramCache.set(key, result);
    const after = diagramCache.stats();
    assert.ok(after.entries >= before.entries);
    assert.ok(after.bytes >= before.bytes);
  });

  test("cacheKey differs with different query_options", () => {
    const k1 = diagramCache.cacheKey("plantuml", "src", "svg", {}, { theme: "dark" });
    const k2 = diagramCache.cacheKey("plantuml", "src", "svg", {}, { theme: "light" });
    assert.notEqual(k1, k2);
  });

  test("cacheKey differs with different header options", () => {
    const k1 = diagramCache.cacheKey("plantuml", "src", "svg", { key: "a" });
    const k2 = diagramCache.cacheKey("plantuml", "src", "svg", { key: "b" });
    assert.notEqual(k1, k2);
  });
});
