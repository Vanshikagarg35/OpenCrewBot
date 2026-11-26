// Integrations. LIVE = really calls the api. MOCK = only pretends, clearly labelled.
// tokens come only from .env, never stored in db or sent to frontend
import { analyzeSalesCsv } from "./csvAnalysis";

export function integrationStatus() {
  return [
    { id: "github", name: "GitHub (REST API)", live: true, note: process.env.GITHUB_TOKEN ? "token set - read + create issue" : "no token - public repo read only, create issue disabled" },
    { id: "slack", name: "Slack (incoming webhook)", live: Boolean(process.env.SLACK_WEBHOOK_URL), note: process.env.SLACK_WEBHOOK_URL ? "webhook set" : "SLACK_WEBHOOK_URL missing -> MOCK" },
    { id: "gmail", name: "Gmail", live: false, note: "MOCK only - draft is saved locally, nothing is sent" },
    { id: "mcp", name: "MCP servers / Composio (original app)", live: true, note: "from original OpenCrewBot Connections panel" },
    { id: "csv", name: "Spreadsheet analysis (local file)", live: true, note: "reads samples/sales_sample.csv" },
  ];
}

function ghHeaders() {
  const h: any = { Accept: "application/vnd.github+json", "User-Agent": "opencrewbot-workforce" };
  if (process.env.GITHUB_TOKEN) h.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  return h;
}

async function githubInspect(repo: string) {
  const base = "https://api.github.com/repos/" + repo;
  const r = await fetch(base, { headers: ghHeaders() });
  if (!r.ok) throw new Error("github " + r.status + " for " + repo);
  const info: any = await r.json();
  const issues: any = await (await fetch(base + "/issues?state=open&per_page=10", { headers: ghHeaders() })).json();
  const files: any = await (await fetch(base + "/contents", { headers: ghHeaders() })).json();
  let s = `Repo: ${info.full_name}\nDescription: ${info.description}\nLanguage: ${info.language}\nStars: ${info.stargazers_count}, open issues: ${info.open_issues_count}\nLast push: ${info.pushed_at}\nLicense: ${info.license?.spdx_id}\n`;
  s += "\nTop level files: " + (Array.isArray(files) ? files.map((f: any) => f.name).join(", ") : "n/a") + "\n";
  s += "\nOpen issues:\n";
  if (Array.isArray(issues)) for (const i of issues) s += `- #${i.number} ${i.title} (opened ${String(i.created_at).slice(0, 10)})\n`;
  return s;
}

// read only actions - no approval needed, result goes into the task prompt
export async function runReadAction(action: any): Promise<string> {
  if (action.type == "github_inspect") return await githubInspect(action.params.repo);
  if (action.type == "analyze_csv") return analyzeSalesCsv(action.params?.file);
  return "";
}

export const EXTERNAL_ACTIONS = ["github_issue", "slack_post", "gmail_send", "gmail_draft"];

export function isExternal(type: string) {
  return EXTERNAL_ACTIONS.includes(type);
}

export function previewAction(action: any): string {
  const p = action.params || {};
  if (action.type == "github_issue") return `Create GitHub issue in ${p.repo}\nTitle: ${p.title}\n\n${(p.body || "").slice(0, 500)}`;
  if (action.type == "slack_post") return `Post to Slack:\n${(p.text || "").slice(0, 500)}`;
  if (action.type == "gmail_send" || action.type == "gmail_draft") return `Email to ${p.to}\nSubject: ${p.subject}\n\n${(p.body || "").slice(0, 500)}`;
  return JSON.stringify(action).slice(0, 500);
}

// ONLY called after approval (or auto allowed by permission level). see taskEngine
export async function executeExternal(action: any): Promise<{ live: boolean; result: string }> {
  const p = action.params || {};
  if (action.type == "github_issue") {
    if (!process.env.GITHUB_TOKEN) return { live: false, result: "[MOCK] GITHUB_TOKEN not set, issue NOT created" };
    const r = await fetch("https://api.github.com/repos/" + p.repo + "/issues", {
      method: "POST",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: p.title, body: p.body }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error("github create issue failed " + r.status + " " + j.message);
    return { live: true, result: "Created issue " + j.html_url };
  }
  if (action.type == "slack_post") {
    if (!process.env.SLACK_WEBHOOK_URL) return { live: false, result: "[MOCK] SLACK_WEBHOOK_URL not set, nothing posted" };
    const r = await fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: p.text }) });
    if (!r.ok) throw new Error("slack failed " + r.status);
    return { live: true, result: "Posted to Slack" };
  }
  if (action.type == "gmail_send" || action.type == "gmail_draft") {
    return { live: false, result: "[MOCK] Gmail is not connected. Draft saved in task output only, NOT sent." };
  }
  throw new Error("unknown action " + action.type);
}
