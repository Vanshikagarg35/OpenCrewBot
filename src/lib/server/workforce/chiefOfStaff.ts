// Chief of Staff = the planner. takes one big instruction and breaks it into tasks
// with agents + dependencies. Uses LLM if a key is there, otherwise rule based plan
// (rule based is also used if LLM gives bad json)
import type { Bot } from "@/lib/shared/types";
import { chat, parseJson } from "./llm";
import { listSkills } from "./skills";

export interface PlannedTask {
  key: string; // t1, t2 ...
  title: string;
  description: string;
  agentId: string;
  dependsOn: string[];
  action: any | null;
}

export interface Plan {
  tasks: PlannedTask[];
  note: string;
  usedLlm: boolean;
}

// capability -> words to look for in agent title/description/skills
const CAPS: any = {
  research: ["research", "scout", "competitor", "market"],
  writing: ["writ", "content", "copy", "quill"],
  marketing: ["market", "campaign", "growth", "brand"],
  analysis: ["analy", "data", "finance", "numbers"],
  code: ["develop", "code", "engineer", "github"],
  review: ["review", "verif", "qa", "critic"],
  ops: ["ops", "operation", "integration", "email", "slack"],
  chief: ["chief", "staff", "planning", "lead"],
};

export function findAgent(bots: Bot[], cap: string, notId?: string): Bot {
  const words = CAPS[cap] || [cap];
  // first check only title + name (skills like "lead-generation" were matching "lead" for chief, bug)
  for (const b of bots) {
    if (b.id == notId) continue;
    const hay = (b.title + " " + b.name).toLowerCase();
    if (words.some((w: string) => hay.includes(w))) return b;
  }
  for (const b of bots) {
    if (b.id == notId) continue;
    const hay = (b.title + " " + b.description + " " + b.name + " " + (b.skills || []).join(" ")).toLowerCase();
    if (words.some((w: string) => hay.includes(w))) return b;
  }
  // nobody matched, just give to first one
  return bots.find((b) => b.id != notId) || bots[0];
}

function repoFrom(text: string) {
  const m = text.match(/github\.com\/([\w.-]+\/[\w.-]+)/i) || text.match(/\b([\w-]+\/[\w.-]+)\b/);
  if (m && !m[1].includes("http")) return m[1].replace(/\.git$/, "");
  return "Studio1-OSS/OpenCrewBot";
}

// ---------- rule based planner (mock mode / fallback) ----------
export function rulePlan(instruction: string, bots: Bot[], startAt = 1, addFinal = true): Plan {
  const t = instruction.toLowerCase();
  const tasks: PlannedTask[] = [];
  let n = startAt;
  const add = (title: string, description: string, cap: string, deps: string[] = [], action: any = null) => {
    const key = "t" + n++;
    tasks.push({ key, title, description, agentId: findAgent(bots, cap).id, dependsOn: deps, action });
    return key;
  };

  if (/competit|market intel|landscape|rival/.test(t)) {
    const a = add("Research competitors - Study Abroad / university applications", "Find competitors for the study abroad and university application business. Products, public pricing, target customers, positioning. Give links.", "research");
    const b = add("Research competitors - career guidance & school partnerships", "Find competitors for student career discovery (Aspirations) and school partnership programs. Products, public pricing, target customers, positioning. Give links.", "research");
    const c = add("Build comparison table and find opportunities", "Using both research results make one comparison table and list strategic opportunities / gaps.", "analysis", [a, b]);
    if (tasks.length) add("Verify findings", "Check the comparison for claims without sources or numbers that look made up. Challenge anything weak.", "review", [c]);
  }
  if (/campaign|marketing|content calendar|class 11|social media/.test(t)) {
    const a = add("Audience research", "Research the target audience (who, concerns, where they are online, what parents think).", "research");
    const b = add("Campaign strategy and creative concepts", "Based on audience research, write campaign strategy and 3 creative concepts.", "marketing", [a]);
    add("30-day content calendar + sample posts", "Make a 30 day content calendar table and write 3 sample posts/scripts.", "writing", [b]);
  }
  if (/spreadsheet|sales|csv|conversion|funnel|revenue/.test(t)) {
    const a = add("Analyse sales spreadsheet", "Look at the real numbers from the spreadsheet analysis. Find bottlenecks and best/worst segments.", "analysis", [], { type: "analyze_csv", params: { file: "./samples/sales_sample.csv" } });
    add("Business recommendations", "Give 5 recommendations based on the analysis, each tied to a number.", "marketing", [a]);
  }
  if (/github|\brepo\b|repository|code review|development plan/.test(t)) { // \b because "report" was matching repo lol
    const repo = repoFrom(instruction);
    const a = add("Inspect GitHub repository " + repo, "Inspect the repo data given below. List technical issues.", "code", [], { type: "github_inspect", params: { repo } });
    const b = add("Prioritised improvements + development plan", "From the issues, make prioritised list (High/Med/Low), proposed changes and a 2-4 week dev plan.", "code", [a]);
    add("Create GitHub issue for top improvement", "Open an issue for the top priority improvement (needs approval).", "code", [b], {
      type: "github_issue",
      params: { repo, title: "Improvement suggestions from AI workforce", body: "(filled from previous task output)" },
    });
  }
  if (/\b(email|mail)\b/.test(t) && /send|draft/.test(t)) {
    const deps = tasks.map((x) => x.key);
    add("Send email", "Send the result by email (external action).", "ops", deps, { type: "gmail_send", params: { to: "team@example.com", subject: "Workforce update", body: "(filled from previous output)" } });
  }
  if (/slack/.test(t)) {
    const deps = tasks.map((x) => x.key);
    add("Post summary to Slack", "Post short summary to Slack (external action).", "ops", deps, { type: "slack_post", params: { text: "(filled from previous output)" } });
  }
  if (tasks.length == 0) {
    // generic
    const a = add("Research the request", "Research what is needed for: " + instruction, "research");
    add("Draft the deliverable", "Write the deliverable using the research.", "writing", [a]);
  }
  if (addFinal) {
    add("Consolidate final deliverable", "Combine all task outputs into ONE final report: summary, key findings, tables, recommendations, next steps.", "chief", tasks.map((x) => x.key));
  }
  return { tasks, note: "Rule-based plan (no LLM key or LLM plan failed)", usedLlm: false };
}

// ---------- LLM planner ----------
export async function makePlan(instruction: string, bots: Bot[], startAt = 1, addFinal = true): Promise<Plan> {
  const roster = bots.map((b) => `- @${b.handle}: ${b.name}, ${b.title}. ${b.description} skills: ${(b.skills || []).join(",")}`).join("\n");
  const skillNames = listSkills().map((s) => s.id).join(", ");
  const sys = `You are the Chief of Staff of an AI team. Break the user's instruction into 2-8 tasks.
Team:
${roster}
Available skills: ${skillNames}
Allowed action types (optional): analyze_csv {file}, github_inspect {repo}, github_issue {repo,title,body}, slack_post {text}, gmail_send {to,subject,body}
Rules:
- tasks that dont depend on each other must have empty dependsOn so they run in parallel
- use the agent whose role fits best
- ${addFinal ? "last task must be consolidation by the chief, depending on all other tasks" : "do not add a consolidation task"}
- task keys must start from t${startAt}
Reply ONLY json: {"note": "...", "tasks":[{"key":"t${startAt}","title":"","description":"","agent":"handle","dependsOn":[],"action":null}]}`;
  try {
    const res = await chat([{ role: "system", content: sys }, { role: "user", content: instruction }], "planning");
    if (!res) return rulePlan(instruction, bots, startAt, addFinal);
    const j = parseJson(res.text);
    if (!j || !Array.isArray(j.tasks) || j.tasks.length == 0) throw new Error("bad plan json");
    const keys = new Set(j.tasks.map((x: any) => x.key));
    const tasks: PlannedTask[] = j.tasks.slice(0, 10).map((x: any) => {
      const bot = bots.find((b) => b.handle == String(x.agent).replace("@", "")) || findAgent(bots, "research");
      return {
        key: String(x.key),
        title: String(x.title || "Task"),
        description: String(x.description || ""),
        agentId: bot.id,
        dependsOn: (x.dependsOn || []).filter((d: string) => keys.has(d) && d != x.key),
        action: x.action && x.action.type ? x.action : null,
      };
    });
    return { tasks, note: String(j.note || "Plan made by LLM"), usedLlm: true };
  } catch (e) {
    console.log("[chief] llm plan failed, using rule plan", e);
    const p = rulePlan(instruction, bots, startAt, addFinal);
    p.note = "LLM plan failed (" + String(e).slice(0, 80) + "), used rule-based plan";
    return p;
  }
}
