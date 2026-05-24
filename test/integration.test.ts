/**
 * Integration tests — require a running Kroki instance.
 * Set SKIP_INTEGRATION=1 to skip (e.g. in CI without Docker).
 * The tests call ensureKrokiRunning() in before(), so Docker must be available.
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { convertDiagram } from "../src/kroki.ts";
import { ensureKrokiRunning } from "../src/docker.ts";

const skip = process.env.SKIP_INTEGRATION === "1" ? "SKIP_INTEGRATION=1" : false;

describe("Kroki round-trips", { skip }, () => {
  before(async () => {
    await ensureKrokiRunning();
  });

  test("plantuml → svg contains <svg> element", async () => {
    const result = await convertDiagram(
      "plantuml",
      "@startuml\nAlice -> Bob: hello\n@enduml",
      "svg"
    );
    assert.equal(result.format, "svg");
    assert.ok((result.data as string).includes("<svg"), "expected SVG document");
  });

  test("graphviz → png has PNG magic bytes", async () => {
    const result = await convertDiagram("graphviz", "digraph { A -> B }", "png");
    assert.equal(result.format, "png");
    const buf = result.data as Buffer;
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50); // P
    assert.equal(buf[2], 0x4e); // N
    assert.equal(buf[3], 0x47); // G
  });

  test("mermaid → svg (companion container)", async () => {
    const result = await convertDiagram(
      "mermaid",
      "graph TD\n  A --> B",
      "svg"
    );
    assert.equal(result.format, "svg");
    assert.ok((result.data as string).includes("<svg"), "expected SVG document");
  });

  test("invalid plantuml source returns 4xx error with hint", async () => {
    await assert.rejects(
      () => convertDiagram("plantuml", "this is not valid plantuml markup !!!", "svg"),
      /syntax error|rejected/i
    );
  });
});
