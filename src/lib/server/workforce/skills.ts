// Skills = markdown files in /skills folder. To add new skill just drop a .md file there
// with the frontmatter (name, keywords, kind). no code change needed.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SKILLS_DIR = resolve(process.env.OPENCREWBOT_SKILLS_DIR || "./skills");

export interface Skill {
  id: string;
  name: string;
  keywords: string[];
  kind: string;
  body: string;
}

function parseSkill(file: string, text: string): Skill {
  let name = file.replace(".md", "");
  let keywords: string[] = [];
  let kind = "research";
  let body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (k.trim() == "name") name = v;
      if (k.trim() == "keywords") keywords = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (k.trim() == "kind") kind = v;
    }
  }
  return { id: file.replace(".md", ""), name, keywords, kind, body: body.trim() };
}

export function listSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => parseSkill(f, readFileSync(join(SKILLS_DIR, f), "utf8")));
}

export function getSkill(id: string): Skill | undefined {
  return listSkills().find((s) => s.id == id);
}

// pick skills for a task using keyword matching.
// agent's own skills get a bonus. (tried embeddings first but too slow for mock mode, so keyword)
export function pickSkills(text: string, agentSkills: string[] = [], max = 2): Skill[] {
  const t = text.toLowerCase();
  const scored = listSkills().map((s) => {
    let score = 0;
    for (const k of s.keywords) {
      if (t.includes(k)) score += 1;
    }
    if (agentSkills.includes(s.id) && score > 0) score += 1;
    return { s, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.s);
}

export function saveSkill(id: string, content: string) {
  const safe = id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  writeFileSync(join(SKILLS_DIR, safe + ".md"), content);
  return safe;
}
