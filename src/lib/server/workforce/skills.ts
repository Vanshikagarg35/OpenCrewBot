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

// Tool catalog for the "Skills & Tools" manager page. Which tools exist, what they
// need, and which permission level they fall under.
export const TOOL_CATALOG = [
  { id: "webSearch", name: "Web search", needs: "TAVILY_API_KEY", category: "read", approval: "no approval (read only)" },
  { id: "memory", name: "Memory (own + team)", needs: "-", category: "read/write", approval: "no approval (local files)" },
  { id: "codeMode", name: "Code mode (run JS)", needs: "-", category: "execute", approval: "Ask / Controlled levels ask first" },
  { id: "browser", name: "Cloud browser", needs: "BROWSERBASE_API_KEY", category: "execute", approval: "Ask / Controlled levels ask first" },
  { id: "askUser", name: "Ask the user", needs: "-", category: "read", approval: "no approval" },
];

// workforce level actions (done by the engine, not by the agent itself)
export const ACTION_CATALOG = [
  { id: "analyze_csv", name: "Analyse spreadsheet", external: false, needs: "a .csv file", live: true },
  { id: "github_inspect", name: "Inspect GitHub repo", external: false, needs: "GITHUB_TOKEN optional", live: true },
  { id: "github_issue", name: "Create GitHub issue", external: true, needs: "GITHUB_TOKEN", live: Boolean(process.env.GITHUB_TOKEN) },
  { id: "slack_post", name: "Post to Slack", external: true, needs: "SLACK_WEBHOOK_URL", live: Boolean(process.env.SLACK_WEBHOOK_URL) },
  { id: "gmail_send", name: "Send email", external: true, needs: "not implemented", live: false },
];
