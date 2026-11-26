// Shared memory files. Same idea as MEMORY.md for each bot (memory-files.ts),
// just more files:
//   data/memory/USER.md        -> user preferences (all agents read this)
//   data/memory/PROJECT.md     -> project memory
//   data/memory/DECISIONS.md   -> important decisions
//   data/memory/HISTORY.md     -> past task runs (short summary)
//   data/workspaces/_rooms/<roomId>/MEMORY.md -> room memory
//
// every line written by the app has provenance: when, who, why
// format: - text _(2026-11-20 · by Scout · why: ...)_

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, WORKSPACES_DIR } from "../config";
import { redactSecrets, memoryPath } from "../memory-files";
import { listBots, listRooms } from "../db";

const MEM_DIR = join(DATA_DIR, "memory");
mkdirSync(MEM_DIR, { recursive: true });

export const SHARED_FILES: any = {
  user: { file: "USER.md", title: "User preferences" },
  project: { file: "PROJECT.md", title: "Project memory" },
  decisions: { file: "DECISIONS.md", title: "Important decisions" },
  history: { file: "HISTORY.md", title: "Task history" },
};

function roomMemPath(roomId: string) {
  const dir = join(WORKSPACES_DIR, "_rooms", roomId.replace(/[^a-zA-Z0-9_-]/g, ""));
  mkdirSync(dir, { recursive: true });
  return join(dir, "MEMORY.md");
}

// scope can be user / project / decisions / history / room:<id> / bot:<id>
export function pathForScope(scope: string): string {
  if (scope.startsWith("room:")) return roomMemPath(scope.slice(5));
  if (scope.startsWith("bot:")) return memoryPath(scope.slice(4));
  const f = SHARED_FILES[scope];
  if (!f) throw new Error("unknown memory scope " + scope);
  const p = join(MEM_DIR, f.file);
  if (!existsSync(p)) writeFileSync(p, `# ${f.title}\n\n`);
  return p;
}

export function readScope(scope: string): string {
  const p = pathForScope(scope);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

export function writeScope(scope: string, content: string) {
  const p = pathForScope(scope);
  writeFileSync(p, redactSecrets(content));
}

export function addMemory(scope: string, text: string, by: string, why: string) {
  const today = new Date().toISOString().slice(0, 16).replace("T", " ");
  let cur = readScope(scope).trimEnd();
  if (!cur) cur = "# Memory";
  const line = `- ${text.trim().replace(/\n+/g, " ")} _(${today} · by ${by} · why: ${why})_`;
  writeScope(scope, cur + "\n" + line + "\n");
}

// for the memory manager page
export async function listMemoryFiles() {
  const out: any[] = [];
  for (const key of Object.keys(SHARED_FILES)) {
    pathForScope(key); // makes file if missing
    out.push({ scope: key, label: SHARED_FILES[key].title, path: pathForScope(key) });
  }
  const bots = await listBots();
  for (const b of bots) {
    out.push({ scope: "bot:" + b.id, label: b.emoji + " " + b.name + " (agent)", path: memoryPath(b.id) });
  }
  const rooms = await listRooms();
  for (const r of rooms) {
    out.push({ scope: "room:" + r.id, label: r.emoji + " " + r.name + " (room)", path: roomMemPath(r.id) });
  }
  return out;
}

// what goes in prompt. keep it small otherwise context gets big
function cut(text: string, maxLines: number) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text.trim();
  // keep last lines bcoz newer is more relevant
  return lines.slice(0, 1).concat(lines.slice(-maxLines)).join("\n").trim();
}

export function sharedMemoryForPrompt(roomId?: string | null): string {
  let s = "";
  s += "### User preferences (USER.md)\n" + cut(readScope("user"), 40) + "\n\n";
  s += "### Project memory (PROJECT.md)\n" + cut(readScope("project"), 40) + "\n\n";
  s += "### Decisions (DECISIONS.md)\n" + cut(readScope("decisions"), 20) + "\n\n";
  if (roomId) {
    s += "### Room memory\n" + cut(readScope("room:" + roomId), 40) + "\n";
  }
  return s;
}

// unused for now
export function allRoomMemoryDirs() {
  const d = join(WORKSPACES_DIR, "_rooms");
  if (!existsSync(d)) return [];
  return readdirSync(d);
}
