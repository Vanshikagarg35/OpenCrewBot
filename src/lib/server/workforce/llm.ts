// Simple LLM caller used by chief of staff (planning) and agent factory.
// The bots themselves still use mastra in runtime.ts, this is just for my own calls.
// All providers here are openai compatible so i am using fetch directly.

import { isMock } from "../config";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export interface Provider {
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  local: boolean;
}

export function getProviders(): Provider[] {
  const list: Provider[] = [];
  if (process.env.NEBIUS_API_KEY) {
    list.push({ name: "nebius", baseUrl: "https://api.tokenfactory.nebius.com/v1", apiKey: process.env.NEBIUS_API_KEY, local: false });
  }
  if (process.env.OPENAI_API_KEY) {
    list.push({ name: "openai", baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY, local: false });
  }
  if (process.env.OLLAMA_BASE_URL) {
    // ollama doesnt need key but the header is required by some versions
    list.push({ name: "ollama", baseUrl: process.env.OLLAMA_BASE_URL, apiKey: "ollama", local: true });
  }
  return list;
}

// model string can be "openai:gpt-4o-mini" or "ollama:llama3.1" or plain nebius id
export function splitModel(model: string): { provider: string; id: string } {
  if (model.startsWith("openai:")) return { provider: "openai", id: model.slice(7) };
  if (model.startsWith("ollama:")) return { provider: "ollama", id: model.slice(7) };
  return { provider: "nebius", id: model };
}

// task based routing. can override from .env like MODEL_FOR_PLANNING=openai:gpt-4o
const DEFAULT_ROUTES: any = {
  planning: "MiniMaxAI/MiniMax-M3",
  research: "MiniMaxAI/MiniMax-M3",
  writing: "Qwen/Qwen3-235B-A22B-Instruct-2507",
  analysis: "deepseek-ai/DeepSeek-V4-Flash-0731",
  code: "moonshotai/Kimi-K2.7-Code",
  summary: "Qwen/Qwen3-30B-A3B-Instruct-2507",
};

export function modelForKind(kind: string): string {
  const envKey = "MODEL_FOR_" + kind.toUpperCase();
  if (process.env[envKey]) return process.env[envKey] as string;
  return DEFAULT_ROUTES[kind] || DEFAULT_ROUTES.planning;
}

export function fallbackModel(): string {
  return process.env.FALLBACK_MODEL || "Qwen/Qwen3-30B-A3B-Instruct-2507";
}

// rough prices per 1M tokens, only for display. not exact!!
const PRICES: any = {
  "MiniMaxAI/MiniMax-M3": [0.3, 1.2],
  "Qwen/Qwen3-235B-A22B-Instruct-2507": [0.2, 0.6],
  "Qwen/Qwen3-30B-A3B-Instruct-2507": [0.1, 0.3],
  "deepseek-ai/DeepSeek-V4-Flash-0731": [0.14, 0.28],
  "moonshotai/Kimi-K2.7-Code": [0.95, 4],
  "openai:gpt-4o-mini": [0.15, 0.6],
  "openai:gpt-4o": [2.5, 10],
};

export function estimateCost(model: string, inTok: number, outTok: number): number {
  if (model.startsWith("ollama:") || model == "mock") return 0; // local = free
  const p = PRICES[model];
  if (!p) return 0;
  return (inTok * p[0] + outTok * p[1]) / 1000000;
}

export interface LlmResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  mock: boolean;
}

async function callOnce(model: string, messages: Msg[]): Promise<LlmResult> {
  const { provider, id } = splitModel(model);
  const p = getProviders().find((x) => x.name == provider);
  if (!p) throw new Error("provider " + provider + " not configured (check .env)");

  const res = await fetch(p.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + p.apiKey },
    body: JSON.stringify({ model: id, messages: messages, temperature: 0.3 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("LLM error " + res.status + ": " + t.slice(0, 200));
  }
  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const tin = data.usage?.prompt_tokens || 0;
  const tout = data.usage?.completion_tokens || 0;
  return { text, model, tokensIn: tin, tokensOut: tout, cost: estimateCost(model, tin, tout), mock: false };
}

// tries main model then fallback. returns null in mock mode so caller can use the rule based version
export async function chat(messages: Msg[], kind = "planning"): Promise<LlmResult | null> {
  if (isMock()) return null;
  const models = [modelForKind(kind), fallbackModel()];
  let lastErr: any = null;
  for (const m of models) {
    try {
      return await callOnce(m, messages);
    } catch (e) {
      console.log("[llm] model failed", m, e);
      lastErr = e;
    }
  }
  throw lastErr;
}

// models sometimes wrap json in ```json ... ``` so strip that
export function parseJson(text: string): any {
  let t = text.trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) t = m[1];
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start == -1 || end == -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}
