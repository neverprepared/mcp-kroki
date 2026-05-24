import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export const KROKI_URL = process.env.KROKI_URL ?? "http://localhost:18000";
const COMPOSE_PROJECT = "kroki-shared";
const COMPOSE_TIMEOUT_MS = 5 * 60_000; // 5 min — allows for image pulls on first run
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_START_MS = 500;
const HEALTH_POLL_MAX_MS = 2_000;

// Resolved at module load so it's portable regardless of cwd.
// spawnSync/spawn receive it as a single argv element — no shell, no injection risk.
const composeFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docker-compose.yml"
);

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
