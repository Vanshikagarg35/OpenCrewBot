// seeds extra agents + rooms for the workforce. runs once (marker file)
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config";
import { listBots, saveBot, listRooms } from "../db";
import { createBot, createRoom } from "../service";
import { DEFAULT_MODEL } from "../models";
import { createWorkflow } from "./scheduler";
import { addMemory } from "./sharedMemory";

const MARKER = join(DATA_DIR, ".seeded-workforce");

export async function seedWorkforce() {
  if (existsSync(MARKER)) return;
  const base = { webSearch: true, memory: true, codeMode: false, browser: false, askUser: true };
  const mk = async (b: any) => createBot({ model: DEFAULT_MODEL, pinned: false, tools: base, approval: "ask", fallbackModel: "Qwen/Qwen3-30B-A3B-Instruct-2507", ...b });

  const chief = await mk({
    name: "Chief",
    title: "Chief of Staff",
    description: "Plans the work, picks agents, and puts the final deliverable together.",
    instructions: "You coordinate the team. When asked to consolidate, merge teammates outputs into one clean report with summary, findings, tables, recommendations and next steps. Point out gaps honestly.",
    emoji: "🧑‍💼",
    color: "#f59e0b",
    pinned: true,
    skills: ["presentation-creation"],
    outputFormat: "Report: Summary, Findings, Tables, Recommendations, Next steps",
  });
  const ledger = await mk({
    name: "Ledger",
    title: "Data & Finance Analyst",
    description: "Analyses spreadsheets, numbers, funnels and financial models.",
    instructions: "Only use real numbers given to you. Show your calculations. Never invent data.",
    emoji: "📊",
    color: "#14b8a6",
    tools: { ...base, codeMode: true },
    skills: ["data-analysis", "financial-modelling"],
    outputFormat: "Markdown tables + bullet recommendations",
  });
  const pixel = await mk({
    name: "Pixel",
    title: "Marketing Strategist",
    description: "Campaign strategy, positioning and creative concepts.",
    instructions: "Think about the audience first. Concepts must be practical for an Indian edtech brand.",
    emoji: "📣",
    color: "#ec4899",
    skills: ["campaign-planning", "market-research", "lead-generation"],
  });
  const byte = await mk({
    name: "Byte",
    title: "Developer",
    description: "Reviews GitHub repositories and writes development plans.",
    instructions: "Be concrete: file names, priorities, effort. Never change a repo without approval.",
    emoji: "🛠️",
    color: "#8b5cf6",
    tools: { ...base, codeMode: true },
    skills: ["code-review"],
    approval: "ask",
  });
  const verity = await mk({
    name: "Verity",
    title: "Reviewer / QA",
    description: "Verifies research, challenges weak conclusions, checks sources.",
    instructions: "Your job is to challenge. List claims without sources, numbers that look made up, and logical gaps. Then give a verdict.",
    emoji: "🔍",
    color: "#64748b",
    skills: ["competitor-analysis"],
  });
  const relay = await mk({
    name: "Relay",
    title: "Ops & Integrations",
    description: "Sends emails, Slack posts and creates GitHub issues (after approval).",
    instructions: "You prepare external actions. They always go through the approval centre.",
    emoji: "📮",
    color: "#0ea5e9",
    skills: ["email-drafting"],
    approval: "controlled",
    allowedActions: ["slack_post"],
    maxActionsPerRun: 1,
  });

  // give original bots skills too
  const bots = await listBots();
  const scout = bots.find((b) => b.handle == "scout");
  const quill = bots.find((b) => b.handle == "quill");
  const atlas = bots.find((b) => b.handle == "atlas");
  if (scout) await saveBot({ ...scout, skills: ["market-research", "competitor-analysis", "lead-generation"] });
  if (quill) await saveBot({ ...quill, skills: ["email-drafting", "campaign-planning", "presentation-creation"] });
  if (atlas) await saveBot({ ...atlas, skills: ["presentation-creation"] });

  const ids = (...l: any[]) => l.filter(Boolean).map((b) => b.id);
  const intel = await createRoom({ name: "Market Intel", topic: "Competitors and market research for MeetUniversity", emoji: "🛰️", memberIds: ids(chief, scout, ledger, verity), leadId: chief.id, responder: "lead", pinned: true });
  await createRoom({ name: "Growth Lab", topic: "Campaigns and content (Aspirations)", emoji: "🚀", memberIds: ids(chief, scout, pixel, quill), leadId: chief.id, responder: "lead", pinned: false });
  await createRoom({ name: "Biz Analysis", topic: "Sales data and revenue", emoji: "📈", memberIds: ids(chief, ledger, pixel, verity), leadId: chief.id, responder: "lead", pinned: false });
  await createRoom({ name: "Dev Team", topic: "Repository review and dev plans", emoji: "💻", memberIds: ids(chief, byte, verity, relay), leadId: chief.id, responder: "lead", pinned: false });

  await createWorkflow(
    "Weekly competitor monitoring",
    "Research the competitive landscape for MeetUniversity (study abroad, Aspirations career discovery, school partnerships). Note any new competitor products or pricing changes and produce a short report.",
    intel.id,
    7 * 24 * 60,
    false,
  );

  addMemory("project", "Business is MeetUniversity (https://www.meetuniversity.com/). Product lines: Aspirations (career discovery for students), Study Abroad / University Applications, School Partnerships.", "seed", "assignment business context");
  writeFileSync(MARKER, new Date().toISOString());
  console.log("[seed] workforce seeded, rooms:", (await listRooms()).length);
}
