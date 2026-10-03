// Usage: node scripts/dev.mjs [next dev options]
// Runs `next dev` and starts it again when it exits abnormally. Turbopack aborts the whole process on
// an internal panic, and Next.js allows one dev server per project, so a dead server stops everyone.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_IN_WINDOW = 5;

const nextArguments = process.argv.slice(2);
const cacheDirectory = path.join(".next", "dev", "cache");
const restarts = [];
let child = null;
let stopping = false;

function start() {
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...nextArguments], {
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    // next dev exits with code 0 when its server process is killed by a signal, so only a stop
    // requested through this process counts as deliberate
    if (stopping) process.exit(code ?? 0);
    const now = Date.now();
    restarts.push(now);
    while (restarts[0] < now - RESTART_WINDOW_MS) restarts.shift();
    if (restarts.length > MAX_RESTARTS_IN_WINDOW) {
      console.error(`next dev exited ${restarts.length} times within a minute; not restarting.`);
      process.exit(1);
    }
    console.error(`next dev exited (${signal ?? `code ${code}`}); clearing its cache and restarting.`);
    // A cache written by a process that aborted is not trusted
    rmSync(cacheDirectory, { recursive: true, force: true });
    setTimeout(start, 1000);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

start();
