import { spawn } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const KROKI_URL = process.env.KROKI_URL ?? "http://localhost:18000";
const COMPOSE_PROJECT = "kroki-shared";
const COMPOSE_TIMEOUT_MS = 5 * 60_000; // 5 min — allows for image pulls on first run
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_START_MS = 500;
const HEALTH_POLL_MAX_MS = 2_000;

// The Kroki stack is embedded here rather than read from a sibling
// docker-compose.yml so the server works as a single compiled binary
// (`bun build --compile`), where there is no file on disk next to the
// executable. It is materialized to a temp file only if the auto-start
// fallback actually runs — the primary path is a shared KROKI_URL endpoint.
const COMPOSE_YAML = `services:
  kroki:
    image: yuzutech/kroki
    ports:
      - "127.0.0.1:18000:8000"
    environment:
      - KROKI_MERMAID_HOST=mermaid
      - KROKI_BPMN_HOST=bpmn
      - KROKI_EXCALIDRAW_HOST=excalidraw
      - KROKI_BLOCKDIAG_HOST=blockdiag
      - KROKI_SEQDIAG_HOST=blockdiag
      - KROKI_ACTDIAG_HOST=blockdiag
      - KROKI_NWDIAG_HOST=blockdiag
      - KROKI_PACKETDIAG_HOST=blockdiag
      - KROKI_RACKDIAG_HOST=blockdiag
      - KROKI_DIAGRAMSNET_HOST=diagramsnet
    depends_on:
      - mermaid
      - bpmn
      - excalidraw
      - blockdiag
      - diagramsnet

  mermaid:
    image: yuzutech/kroki-mermaid

  bpmn:
    image: yuzutech/kroki-bpmn

  excalidraw:
    image: yuzutech/kroki-excalidraw

  blockdiag:
    image: yuzutech/kroki-blockdiag

  diagramsnet:
    image: yuzutech/kroki-diagramsnet
`;

// Materialize the embedded compose to a stable temp path so `docker compose`
// (a separate process) can read it. A stable path means the same project reuses
// one file across runs. spawn receives it as a single argv element — no shell.
function composeFilePath(): string {
  const dir = join(tmpdir(), COMPOSE_PROJECT);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "docker-compose.yml");
  writeFileSync(path, COMPOSE_YAML);
  return path;
}

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${KROKI_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    // Kroki returns {"status":"pass"} — validate to avoid false positives
    // from other services that happen to expose a /health endpoint.
    const body = await res.json() as Record<string, unknown>;
    return body["status"] === "pass";
  } catch {
    return false;
  }
}

function startContainers(): Promise<void> {
  return new Promise((resolve, reject) => {
    const composeFile = composeFilePath();
    const proc = spawn(
      "docker",
      ["compose", "-p", COMPOSE_PROJECT, "-f", composeFile, "up", "-d"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(
        `docker compose up timed out after ${COMPOSE_TIMEOUT_MS / 60_000} minutes. ` +
        "Images may still be pulling — run 'docker compose -p kroki-shared pull' manually first."
      ));
    }, COMPOSE_TIMEOUT_MS);

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      clearTimeout(timer);
      const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
      reject(new Error(
        isNotFound
          ? "docker not found on PATH — is Docker installed and running?"
          : `Failed to invoke docker: ${err.message}`
      ));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`docker compose up failed (exit ${code}):\n${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let delay = HEALTH_POLL_START_MS;

  while (Date.now() < deadline) {
    if (await isHealthy()) return;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, HEALTH_POLL_MAX_MS);
  }

  throw new Error(
    "Kroki did not become healthy within 30s — ensure Docker is running and port 18000 is free. " +
    "On first run, images may still be pulling; wait a moment and try again."
  );
}

// Single-flight latch: concurrent callers share one start attempt.
let startingPromise: Promise<void> | null = null;

export async function ensureKrokiRunning(): Promise<void> {
  if (await isHealthy()) return;
  if (!startingPromise) {
    startingPromise = startContainers()
      .then(() => waitForHealth())
      .finally(() => { startingPromise = null; });
  }
  return startingPromise;
}
