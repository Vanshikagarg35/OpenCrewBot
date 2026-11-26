// Agent factory - create agent from natural language
// eg: "create a finance agent called Ledger that does financial models, should ask before sending anything"
import type { BotInput } from "@/lib/shared/types";
import { chat, parseJson } from "./llm";
import { listSkills, pickSkills } from "./skills";
import { DEFAULT_MODEL } from "../models";

const EMOJIS = ["🤖", "🧠", "📊", "🛠️", "📣", "🔎", "📝", "💼", "🧪", "🎯"];
const COLORS = ["#2f7df6", "#e0663d", "#1f9d6b", "#a855f7", "#eab308", "#ec4899", "#14b8a6"];

function ruleBased(text: string): BotInput {
  const t = text.toLowerCase();
  // name: "called X" / "named X" / "name it X"
  const nm = text.match(/(?:called|named|name it|name:)\s+["']?([A-Z][\w-]{1,30})/i);
  const name = nm ? nm[1] : "Agent" + Math.floor(Math.random() * 1000);
  const role = text.match(/(?:a|an)\s+([\w\s-]{3,40}?)\s+(?:agent|bot|assistant)/i);
  const title = role ? role[1].trim().replace(/^\w/, (c) => c.toUpperCase()) : "Assistant";
  const skills = pickSkills(text, [], 3).map((s) => s.id);
  let approval: any = "ask";
  if (/full access|autonomous|without asking/.test(t)) approval = "full";
  else if (/controlled|pre.?approved|limited/.test(t)) approval = "controlled";
  let outputFormat = "Markdown with headings and bullet points";
  if (/table/.test(t)) outputFormat = "Markdown tables where possible";
  if (/json/.test(t)) outputFormat = "JSON";
  return {
    name,
    title,
    description: text.slice(0, 160),
    instructions: `You are ${name}, a ${title}. ${text}\nAlways follow the team's USER.md preferences. Be specific and cite sources for facts.`,
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    model: DEFAULT_MODEL,
    tools: { webSearch: /research|search|web|market|competitor/.test(t), memory: true, codeMode: /code|calculat|analy|data/.test(t), browser: /browse|website/.test(t), askUser: true },
    approval,
    pinned: false,
    skills,
    outputFormat,
    fallbackModel: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    allowedActions: approval == "controlled" ? ["slack_post"] : [],
    maxActionsPerRun: 2,
  };
}

export async function generateAgent(text: string): Promise<{ bot: BotInput; usedLlm: boolean }> {
  if (!text.trim()) throw new Error("describe the agent first");
  const base = ruleBased(text);
  try {
    const res = await chat(
      [
        {
          role: "system",
          content: `Turn the user's description into an agent config. Reply only JSON with keys: name, title, description, instructions, emoji, skills (array, choose from: ${listSkills().map((s) => s.id).join(", ")}), tools {webSearch, memory, codeMode, browser, askUser} booleans, approval ("ask"|"controlled"|"full"), outputFormat, model (optional).`,
        },
        { role: "user", content: text },
      ],
      "planning",
    );
    if (!res) return { bot: base, usedLlm: false };
    const j = parseJson(res.text);
    if (!j || !j.name) return { bot: base, usedLlm: false };
    return {
      bot: {
        ...base,
        name: String(j.name).slice(0, 40),
        title: j.title || base.title,
        description: j.description || base.description,
        instructions: j.instructions || base.instructions,
        emoji: j.emoji || base.emoji,
        skills: Array.isArray(j.skills) ? j.skills : base.skills,
        tools: { ...base.tools, ...(j.tools || {}) },
        approval: ["ask", "controlled", "full"].includes(j.approval) ? j.approval : base.approval,
        outputFormat: j.outputFormat || base.outputFormat,
        model: j.model || base.model,
      },
      usedLlm: true,
    };
  } catch (e) {
    console.log("agent factory llm failed", e);
    return { bot: base, usedLlm: false };
  }
}
