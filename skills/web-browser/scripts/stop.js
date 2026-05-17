#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env["HOME"] || homedir();
const STATE_FILE = join(HOME, ".cache", "agent-web", "browser", "state.json");

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function clearState() {
  try {
    rmSync(STATE_FILE, { force: true });
  } catch {
    // ignore
  }
}

function isAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const state = readState();
  if (!state?.pid) {
    console.log("No managed browser is recorded.");
    clearState();
    process.exit(0);
  }

  const pid = state.pid;
  if (!isAlive(pid)) {
    console.log(`Browser process ${pid} is not running.`);
    clearState();
    process.exit(0);
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    console.error(`Failed to stop browser process ${pid}: ${error?.message ?? String(error)}`);
    process.exit(1);
  }

  for (let i = 0; i < 20; i += 1) {
    if (!isAlive(pid)) {
      clearState();
      console.log(`Stopped browser process ${pid}.`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }

  for (let i = 0; i < 20; i += 1) {
    if (!isAlive(pid)) {
      clearState();
      console.log(`Stopped browser process ${pid} (forced).`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.error(`Failed to stop browser process ${pid}.`);
  process.exit(1);
}

await main();
