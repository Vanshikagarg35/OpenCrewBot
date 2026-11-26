// Execution engine. run -> tasks -> agents
// - tasks with all deps done run in parallel (batch of MAX_PARALLEL)
// - retry with backoff, fallback model on retry
// - timeout per task
// - approval for external actions (rejected = never executed)
// - collaboration: agent writes DELEGATE / ASK / VERIFY @handle or CHALLENGE -> new task (max depth 2)
// - recovery: on server start, unfinished runs continue (see recoverRuns)
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bot, ChatMessage, WfRun, WfTask } from "@/lib/shared/types";
import { db, getBot, getRoom, listBots, saveMessage } from "../db";
import { publish } from "../bus";
import { DATA_DIR, isMock } from "../config";
import { runTurn, stopConversation } from "../runtime";
import { makePlan, findAgent } from "./chiefOfStaff";
import { pickSkills } from "./skills";
import { readScope, addMemory } from "./sharedMemory";
import { runReadAction, isExternal, previewAction, executeExternal } from "./integrations";
import { audit, createApproval, getApproval, needsApproval } from "./approvals";
import { modelForKind, fallbackModel, estimateCost } from "./llm";

const MAX_PARALLEL = Number(process.env.OPENCREWBOT_MAX_PARALLEL_TASKS || 3);
const TASK_TIMEOUT_MS = Number(process.env.OPENCREWBOT_TASK_TIMEOUT_MINUTES || 5) * 60 * 1000;
const MAX_TASKS_PER_RUN = 20;
const MAX_DELEGATION_DEPTH = 2;

const g = globalThis as any;
if (!g.__wfActive) g.__wfActive = new Set<string>(); // runs that have an executor loop going
const active: Set<string> = g.__wfActive;

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- db helpers ----------------
function rowToTask(r: any): WfTask {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    title: String(r.title),
    description: String(r.description || ""),
    agentId: String(r.agent_id),
    dependsOn: JSON.parse(String(r.depends_on || "[]")),
    status: r.status,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    output: r.output,
    error: r.error,
    needsApproval: Number(r.needs_approval) == 1,
    action: r.action ? JSON.parse(String(r.action)) : null,
    skills: JSON.parse(String(r.skills || "[]")),
    model: r.model,
    tokensIn: Number(r.tokens_in || 0),
    tokensOut: Number(r.tokens_out || 0),
    cost: Number(r.cost || 0),
    depth: Number(r.depth || 0),
    parentId: r.parent_id,
    createdAt: String(r.created_at),
  };
}

function rowToRun(r: any): WfRun {
  return {
    id: String(r.id),
    roomId: r.room_id,
    instruction: String(r.instruction),
    status: r.status,
    planNote: String(r.plan_note || ""),
    finalOutput: r.final_output,
    workflowId: r.workflow_id,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getTasks(runId: string): Promise<WfTask[]> {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_tasks WHERE run_id = ? ORDER BY created_at, id", args: [runId] });
  return r.rows.map(rowToTask);
}

export async function getRun(id: string): Promise<WfRun | null> {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_runs WHERE id = ?", args: [id] });
  if (!r.rows[0]) return null;
  const run = rowToRun(r.rows[0]);
  run.tasks = await getTasks(id);
  const bots = await listBots();
  for (const t of run.tasks) t.agentName = bots.find((b) => b.id == t.agentId)?.name || "?";
  return run;
}

export async function listRuns(limit = 50): Promise<WfRun[]> {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_runs ORDER BY created_at DESC LIMIT ?", args: [limit] });
  const runs = r.rows.map(rowToRun);
  for (const run of runs) {
    const t = await getTasks(run.id);
    (run as any).taskCount = t.length;
    (run as any).doneCount = t.filter((x) => x.status == "done").length;
    (run as any).cost = t.reduce((s, x) => s + x.cost, 0);
    (run as any).tokens = t.reduce((s, x) => s + x.tokensIn + x.tokensOut, 0);
  }
  return runs;
}

async function setRunStatus(id: string, status: string, finalOutput?: string) {
  if (finalOutput !== undefined) {
    await (await db()).execute({ sql: "UPDATE wf_runs SET status = ?, final_output = ?, updated_at = ? WHERE id = ?", args: [status, finalOutput, now(), id] });
  } else {
    await (await db()).execute({ sql: "UPDATE wf_runs SET status = ?, updated_at = ? WHERE id = ?", args: [status, now(), id] });
  }
  publish({ type: "rooms-changed" }); // hack: makes ui refresh, there is no workforce event type
}

async function updateTask(id: string, fields: any) {
  const map: any = {
    status: "status", attempts: "attempts", startedAt: "started_at", finishedAt: "finished_at", output: "output",
    error: "error", needsApproval: "needs_approval", skills: "skills", model: "model", tokensIn: "tokens_in",
    tokensOut: "tokens_out", cost: "cost", dependsOn: "depends_on",
  };
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of Object.keys(fields)) {
    sets.push(map[k] + " = ?");
    let v = fields[k];
    if (k == "skills" || k == "dependsOn") v = JSON.stringify(v);
    if (k == "needsApproval") v = v ? 1 : 0;
    args.push(v);
  }
  args.push(id);
  await (await db()).execute({ sql: `UPDATE wf_tasks SET ${sets.join(", ")} WHERE id = ?`, args });
}

async function insertTask(runId: string, t: any) {
  await (await db()).execute({
    sql: `INSERT INTO wf_tasks (id, run_id, title, description, agent_id, depends_on, status, attempts, max_attempts, action, skills, depth, parent_id, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [t.id, runId, t.title, t.description, t.agentId, JSON.stringify(t.dependsOn || []), "pending", 0, t.maxAttempts || 3, t.action ? JSON.stringify(t.action) : null, "[]", t.depth || 0, t.parentId || null, now()],
  });
}

// post a message in the room so user can see whats happening
async function notice(conversationId: string, text: string) {
  const m: ChatMessage = { id: randomUUID(), conversationId, role: "notice", createdAt: now(), status: "done", parts: [{ kind: "text", text }] };
  await saveMessage(m);
  publish({ type: "message", message: m });
}

async function conversationFor(run: WfRun) {
  if (run.roomId) return "room:" + run.roomId;
  const bots = await listBots();
  const chief = findAgent(bots, "chief");
  return "dm:" + chief.id;
}

async function membersFor(roomId: string | null): Promise<Bot[]> {
  const all = await listBots();
  if (!roomId) return all;
  const room = await getRoom(roomId);
  if (!room) return all;
  const m = all.filter((b) => room.memberIds.includes(b.id));
  return m.length ? m : all;
}

function planMarkdown(tasks: any[], bots: Bot[]) {
  let s = "| # | Task | Agent | Depends on |\n|---|---|---|---|\n";
  for (const t of tasks) {
    const b = bots.find((x) => x.id == t.agentId);
    s += `| ${t.id.split("-").pop()} | ${t.title}${t.action ? " _(action: " + t.action.type + ")_" : ""} | ${b ? b.name : "?"} | ${t.dependsOn.map((d: string) => d.split("-").pop()).join(", ") || "-"} |\n`;
  }
  return s;
}

// ---------------- start a run ----------------
export async function startRun(instruction: string, roomId: string | null, workflowId: string | null = null): Promise<string> {
  if (!instruction.trim()) throw new Error("instruction is empty");
  const id = "run-" + randomUUID().slice(0, 6);
  await (await db()).execute({
    sql: "INSERT INTO wf_runs (id, room_id, instruction, status, plan_note, workflow_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    args: [id, roomId, instruction, "planning", "", workflowId, now(), now()],
  });
  await audit("user", "run_started", { id, instruction: instruction.slice(0, 200) });

  const bots = await membersFor(roomId);
  const plan = await makePlan(instruction, bots);
  const rows = plan.tasks.map((t) => ({ ...t, id: id + "-" + t.key, dependsOn: t.dependsOn.map((d) => id + "-" + d) }));
  for (const r of rows) await insertTask(id, r);
  await (await db()).execute({ sql: "UPDATE wf_runs SET plan_note = ?, status = 'running' WHERE id = ?", args: [plan.note, id] });

  const run = (await getRun(id))!;
  const conv = await conversationFor(run);
  await notice(conv, `🧭 **Chief of Staff plan** for run \`${id}\` ${isMock() ? "**(MOCK MODE)**" : ""}\n\n> ${instruction.slice(0, 300)}\n\n${planMarkdown(rows, await listBots())}\n_${plan.note}_`);

  void executeRun(id); // dont await, runs in background
  return id;
}

// ---------------- main loop ----------------
export async function executeRun(runId: string) {
  if (active.has(runId)) return; // already running
  active.add(runId);
  try {
    let loops = 0;
    while (loops < 500) {
      loops++;
      const run = await getRun(runId);
      if (!run || run.status == "cancelled") break;
      const tasks = run.tasks || [];
      const byId: any = {};
      tasks.forEach((t) => (byId[t.id] = t));

      // tasks whose dependency failed cant run
      for (const t of tasks) {
        if (t.status != "pending") continue;
        const bad = t.dependsOn.find((d) => ["failed", "rejected", "cancelled", "skipped"].includes(byId[d]?.status));
        // consolidation still runs with what we have (partial result better than nothing)
        if (bad && !t.title.toLowerCase().startsWith("consolidate")) {
          await updateTask(t.id, { status: "skipped", error: "dependency " + bad + " did not finish" });
          t.status = "skipped";
        }
      }

      const ready = tasks.filter((t) => t.status == "pending" && t.dependsOn.every((d) => ["done", "failed", "rejected", "cancelled", "skipped"].includes(byId[d]?.status) && (byId[d]?.status == "done" || t.title.toLowerCase().startsWith("consolidate"))));
      if (ready.length == 0) {
        const stillGoing = tasks.some((t) => t.status == "running" || t.status == "waiting_approval" || t.status == "pending");
        if (!stillGoing) break;
        // pending but not ready = waiting for something that will never come? check
        if (!tasks.some((t) => t.status == "running" || t.status == "waiting_approval")) {
          console.log("[engine] stuck run", runId);
          for (const t of tasks.filter((x) => x.status == "pending")) await updateTask(t.id, { status: "skipped", error: "stuck - deps never finished" });
          break;
        }
        await sleep(1000);
        continue;
      }
      const batch = ready.slice(0, MAX_PARALLEL);
      await Promise.all(batch.map((t) => runTask(run, t, byId)));
    }
    await finishRun(runId);
  } catch (e) {
    console.log("[engine] run crashed", runId, e);
    await setRunStatus(runId, "failed");
  } finally {
    active.delete(runId);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout after " + Math.round(ms / 1000) + "s")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function buildPrompt(run: WfRun, task: WfTask, bot: Bot, byId: any, toolData: string) {
  const skills = pickSkills(task.title + " " + task.description + " " + run.instruction, bot.skills || []);
  await updateTask(task.id, { skills: skills.map((s) => s.id) });
  let p = `TASK: ${task.title}\n\n${task.description}\n\nOverall instruction from user:\n${run.instruction}\n`;
  if (bot.outputFormat) p += `\nYour output format: ${bot.outputFormat}\n`;
  for (const s of skills) p += `\n--- SKILL: ${s.name} ---\n${s.body}\n`;
  if (run.roomId) p += `\n--- ROOM MEMORY ---\n${readScope("room:" + run.roomId).slice(-2000)}\n`;
  const deps = task.dependsOn.map((d) => byId[d]).filter(Boolean);
  if (deps.length) {
    p += "\n--- RESULTS FROM TEAMMATES ---\n";
    for (const d of deps) p += `\n## ${d.title} (${d.status})\n${(d.output || d.error || "").slice(0, 4000)}\n`;
  }
  if (toolData) p += `\n=== TOOL DATA (REAL) ===\n${toolData}\n=== END TOOL DATA ===\n`;
  p += `\nTeam handles you can work with: ${(await listBots()).filter((b) => b.id != bot.id).map((b) => "@" + b.handle + " (" + b.title + ")").join(", ")}\n`;
  p += `\nRules:
- do only your part of the work
- if you need a teammate, write ONE line at the end: DELEGATE @handle: what you need / ASK @handle: your question / VERIFY @handle: what to check
- if a teammate's result above looks wrong or has no evidence, write: CHALLENGE: reason
- only do this if it is really needed, dont ask the same person twice
- dont do external actions (email, slack, github issue) yourself. the system does them after human approval.`;
  return { prompt: p, skills };
}

async function runTask(run: WfRun, task: WfTask, byId: any) {
  const bot = await getBot(task.agentId);
  if (!bot) {
    await updateTask(task.id, { status: "failed", error: "agent deleted" });
    return;
  }
  const conv = await conversationFor(run);
  await updateTask(task.id, { status: "running", startedAt: now() });
  await audit(bot.name, "task_started", { task: task.id });

  try {
    // 1) external action -> approval flow
    if (task.action && isExternal(task.action.type)) {
      await runExternalTask(run, task, bot, byId, conv);
      return;
    }
    // 2) read action data (csv / github) - real data
    let toolData = "";
    if (task.action) {
      try {
        toolData = await runReadAction(task.action);
      } catch (e: any) {
        toolData = "Tool failed: " + e.message;
      }
    }
    const { prompt, skills } = await buildPrompt(run, task, bot, byId, toolData);

    // 3) ask agent, with retries
    let attempts = task.attempts;
    let lastErr = "";
    while (attempts < task.maxAttempts) {
      attempts++;
      let model: string | undefined = undefined;
      if (!isMock()) {
        if (attempts > 1) model = bot.fallbackModel || fallbackModel();
        else if (process.env.TASK_MODEL_ROUTING == "1") model = modelForKind(skills[0]?.kind || "research");
      }
      await updateTask(task.id, { attempts, model: model || (isMock() ? "mock" : bot.model) });
      try {
        const reply = await withTimeout(runTurn({ bot, conversationId: conv, content: prompt, modelOverride: model }), TASK_TIMEOUT_MS);
        if (!reply) throw new Error("turn was stopped");
        if (reply.status != "done") throw new Error(reply.error || "agent turn " + reply.status);
        const text = reply.parts.filter((p) => p.kind == "text").map((p: any) => p.text).join("\n").trim();
        if (!text) throw new Error("empty output");
        const tin = reply.usage?.input || 0;
        const tout = reply.usage?.output || 0;
        const cost = reply.usage?.costUsd ?? estimateCost(model || bot.model, tin, tout);
        const finalText = toolData && !text.includes("TOOL DATA") && isMock() ? text : text;
        await updateTask(task.id, { status: "done", output: finalText, finishedAt: now(), error: null, tokensIn: tin, tokensOut: tout, cost: cost || 0 });
        await audit(bot.name, "task_done", { task: task.id, attempts });
        await handleCollaboration(run, task, bot, text);
        return;
      } catch (e: any) {
        lastErr = e.message || String(e);
        console.log("[engine] task failed attempt", attempts, task.id, lastErr);
        await audit(bot.name, "task_attempt_failed", { task: task.id, attempts, error: lastErr });
        // check if run got cancelled in between
        const fresh = await getRun(run.id);
        if (fresh?.status == "cancelled") return;
        if (attempts < task.maxAttempts) await sleep(1000 * attempts * 2); // backoff 2s, 4s
      }
    }
    await updateTask(task.id, { status: "failed", error: lastErr, finishedAt: now() });
    await notice(conv, `⚠️ Task **${task.title}** failed after ${attempts} attempts: ${lastErr}. You can retry it from the Workforce dashboard.`);
  } catch (e: any) {
    await updateTask(task.id, { status: "failed", error: String(e.message || e), finishedAt: now() });
  }
}

async function runExternalTask(run: WfRun, task: WfTask, bot: Bot, byId: any, conv: string) {
  const action = JSON.parse(JSON.stringify(task.action));
  // fill the placeholder text from previous task output
  const prevOut = task.dependsOn.map((d) => byId[d]?.output || "").join("\n\n").slice(0, 3000);
  for (const k of Object.keys(action.params || {})) {
    if (String(action.params[k]).includes("(filled from previous")) action.params[k] = prevOut || "(no previous output)";
  }
  const used = Object.values(byId).filter((t: any) => t.action && isExternal(t.action.type) && t.status == "done").length;
  const need = needsApproval(bot, action.type, used);

  if (need) {
    // reuse approval if we already created one (after restart)
    let approvalId = (task.error || "").startsWith("approval:") ? task.error!.slice(9) : null;
    if (!approvalId) {
      approvalId = await createApproval(run.id, task.id, bot.id, action.type, previewAction(action), action);
      await updateTask(task.id, { status: "waiting_approval", needsApproval: true, error: "approval:" + approvalId });
      await notice(conv, `✋ **Approval needed** (${bot.name}, ${bot.approval}): ${action.type}\n\n\`\`\`\n${previewAction(action)}\n\`\`\`\nOpen **Workforce → Approval Centre** to approve or reject.`);
    } else {
      await updateTask(task.id, { status: "waiting_approval" });
    }
    // wait for decision (30 min max)
    const started = Date.now();
    let decision = "pending";
    while (Date.now() - started < 30 * 60 * 1000) {
      const a = await getApproval(approvalId);
      const r = await getRun(run.id);
      if (r?.status == "cancelled") {
        await updateTask(task.id, { status: "cancelled", finishedAt: now() });
        return;
      }
      if (a && a.status != "pending") {
        decision = a.status;
        break;
      }
      await sleep(1500);
    }
    if (decision != "approved") {
      // REJECTED -> never execute. this is important
      await updateTask(task.id, { status: "rejected", output: "Action was " + (decision == "pending" ? "not approved in time" : "REJECTED") + ". Nothing was executed.", finishedAt: now() });
      await audit("system", "action_not_executed", { task: task.id, type: action.type, decision });
      await notice(conv, `🚫 Action **${action.type}** was ${decision == "pending" ? "not approved in time" : "rejected"}. It was **not executed**.`);
      return;
    }
  } else {
    await audit(bot.name, "auto_approved", { task: task.id, type: action.type, level: bot.approval });
  }

  try {
    const res = await executeExternal(action);
    await updateTask(task.id, { status: "done", output: (res.live ? "[LIVE] " : "") + res.result, finishedAt: now(), error: null });
    await audit(bot.name, "action_executed", { task: task.id, type: action.type, live: res.live, result: res.result });
  } catch (e: any) {
    await updateTask(task.id, { status: "failed", error: e.message, finishedAt: now() });
    await audit(bot.name, "action_failed", { task: task.id, error: e.message });
  }
}

// Agent to agent collaboration. An agent can write these lines in its output:
//   DELEGATE @handle: do this extra work
//   ASK @handle: question i need answered
//   VERIFY @handle: please check this
//   CHALLENGE: reason why a teammate's result looks wrong
// each one becomes a new task so the work is tracked, not just chat.
//
// loop prevention (assignment says prevent endless delegation):
//   1. depth limit (MAX_DELEGATION_DEPTH = 2)
//   2. max 20 tasks per run
//   3. max 2 requests per task output
//   4. same from->to->kind pair is allowed only once per run (stops A asks B, B asks A, A asks B...)
const KINDS: any = {
  DELEGATE: { label: "Delegated by", verb: "delegated", prefix: "d" },
  ASK: { label: "Question from", verb: "asked", prefix: "q" },
  VERIFY: { label: "Verification asked by", verb: "asked_verification", prefix: "v" },
};

function isFinalTask(t: { title: string }) {
  return t.title.toLowerCase().startsWith("consolidate");
}

async function handleCollaboration(run: WfRun, task: WfTask, bot: Bot, text: string) {
  // the consolidation task is the last step, it cannot ask anyone.
  // (if it does we get a deadlock: new task waits for consolidate, consolidate waits for new task)
  if (isFinalTask(task)) return;
  const conv = await conversationFor(run);
  const all = await getTasks(run.id);
  const bots = await listBots();

  // pairs that already happened in this run, so we dont go round and round
  const seen = new Set<string>();
  for (const t of all) {
    if (t.parentId) seen.add(t.title.split(":")[0] + "->" + t.agentId);
  }

  const reqs = [...text.matchAll(/^(DELEGATE|ASK|VERIFY) @([a-z0-9_-]+):\s*(.+)$/gim)].slice(0, 2);
  for (const m of reqs) {
    const kind = KINDS[m[1].toUpperCase()];
    const target = bots.find((b) => b.handle == m[2].toLowerCase());
    if (!target || target.id == bot.id) continue;
    if (task.depth >= MAX_DELEGATION_DEPTH) {
      await audit(bot.name, "collaboration_blocked", { reason: "max depth " + MAX_DELEGATION_DEPTH, task: task.id });
      await notice(conv, `🔁 ${bot.name} wanted to involve @${target.handle} but the delegation depth limit was reached, so it was skipped.`);
      continue;
    }
    if (all.length >= MAX_TASKS_PER_RUN) {
      await audit(bot.name, "collaboration_blocked", { reason: "max tasks", task: task.id });
      break;
    }
    const pair = kind.label + " " + bot.name + "->" + target.id;
    if (seen.has(kind.label + " " + bot.name + "->" + target.id)) {
      await audit(bot.name, "collaboration_blocked", { reason: "same request already made in this run", to: target.name });
      continue;
    }
    seen.add(pair);

    const id = run.id + "-" + kind.prefix + randomUUID().slice(0, 4);
    await insertTask(run.id, {
      id,
      title: `${kind.label} ${bot.name}: ${m[3].slice(0, 60)}`,
      description: m[3] + (m[1].toUpperCase() == "ASK" ? "\n\nAnswer this question directly and shortly." : ""),
      agentId: target.id,
      dependsOn: [task.id],
      depth: task.depth + 1,
      parentId: task.id,
    });
    all.push({ id, title: `${kind.label} ${bot.name}`, agentId: target.id, parentId: task.id, dependsOn: [task.id] } as any);
    await reopenFinal(run.id, all, id);
    await audit(bot.name, kind.verb, { to: target.name, task: id });
    await notice(conv, `🤝 **${bot.name} → @${target.handle}** (${m[1].toLowerCase()}): ${m[3].slice(0, 200)}`);
  }

  // CHALLENGE has no @handle, it goes to a reviewer agent
  const ch = text.match(/^CHALLENGE:\s*(.+)$/im);
  if (ch && task.depth < MAX_DELEGATION_DEPTH && all.length < MAX_TASKS_PER_RUN) {
    const reviewer = findAgent(bots, "review", bot.id);
    if (reviewer && !seen.has("Challenge->" + reviewer.id)) {
      const id = run.id + "-c" + randomUUID().slice(0, 4);
      await insertTask(run.id, {
        id,
        title: `Challenge from ${bot.name}: ${ch[1].slice(0, 50)}`,
        description: `${bot.name} challenged an earlier result. Reason: ${ch[1]}\n\nRe-check the result above, say if the challenge is correct or not, and give the corrected version.`,
        agentId: reviewer.id,
        dependsOn: [task.id],
        depth: task.depth + 1,
        parentId: task.id,
      });
      all.push({ id } as any);
      await reopenFinal(run.id, all, id);
      await audit(bot.name, "challenged", { reviewer: reviewer.name, task: id, reason: ch[1].slice(0, 200) });
      await notice(conv, `⚠️ **${bot.name} challenged a result:** ${ch[1].slice(0, 200)}\n@${reviewer.handle} will verify it.`);
      if (run.roomId) addMemory("room:" + run.roomId, `${bot.name} challenged a result: ${ch[1].slice(0, 120)}`, bot.name, "disagreement in the room, kept for context");
    }
  }
}

// the consolidation task must wait for newly added tasks also
async function reopenFinal(runId: string, all: any[], newId: string) {
  const final = all.find((t: any) => t.title && isFinalTask(t));
  if (!final) return;
  const tasks = await getTasks(runId);
  const fresh = tasks.find((t) => t.id == final.id);
  if (!fresh) return;
  // safety: never make the final task wait for something that is waiting for the final task
  const added = tasks.find((t) => t.id == newId);
  if (added && added.dependsOn.includes(final.id)) return;
  await updateTask(final.id, { dependsOn: [...fresh.dependsOn, newId], status: fresh.status == "done" ? "pending" : fresh.status, output: fresh.status == "done" ? null : fresh.output });
}

async function finishRun(runId: string) {
  const run = await getRun(runId);
  if (!run || run.status == "cancelled") return;
  const tasks = run.tasks || [];
  const final = [...tasks].reverse().find((t) => t.title.toLowerCase().startsWith("consolidate"));
  const failed = tasks.filter((t) => ["failed", "skipped"].includes(t.status)).length;
  const status = failed == 0 ? "done" : final?.status == "done" ? "partial" : "failed";

  const cost = tasks.reduce((s, t) => s + t.cost, 0);
  const tokens = tasks.reduce((s, t) => s + t.tokensIn + t.tokensOut, 0);
  let report = `# Workforce report - ${run.id}\n\n`;
  report += `**Mode:** ${isMock() ? "MOCK (agent text is placeholder, tool data sections are real)" : "LIVE model"}  \n`;
  report += `**Instruction:** ${run.instruction}\n**Status:** ${status} · ${tasks.length} tasks · ${tokens} tokens · ~$${cost.toFixed(4)}\n\n`;
  report += `## Final deliverable\n\n${final?.output || "(consolidation did not run)"}\n\n## Task outputs\n`;
  for (const t of tasks) {
    if (t === final) continue;
    report += `\n### ${t.title} — ${t.agentName} [${t.status}]\n\n${t.output || t.error || ""}\n`;
  }
  await setRunStatus(runId, status, report);
  try {
    const dir = join(DATA_DIR, "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, runId + ".md"), report);
  } catch (e) {
    console.log(e);
  }
  addMemory("history", `Run ${runId}: "${run.instruction.slice(0, 80)}" -> ${status}`, "Chief of Staff", "run finished");
  if (run.roomId) addMemory("room:" + run.roomId, `Finished run ${runId} (${status}): ${run.instruction.slice(0, 80)}`, "Chief of Staff", "keep room context");
  await notice(await conversationFor(run), `✅ Run \`${runId}\` finished: **${status}**. Full report in Workforce → Runs (also saved to data/reports/${runId}.md).`);
}

// ---------------- controls ----------------
export async function cancelRun(runId: string) {
  const run = await getRun(runId);
  if (!run) throw new Error("run not found");
  await setRunStatus(runId, "cancelled");
  for (const t of run.tasks || []) {
    if (["pending", "running", "waiting_approval"].includes(t.status)) await updateTask(t.id, { status: "cancelled", finishedAt: now() });
  }
  await stopConversation(await conversationFor(run));
  await audit("user", "run_cancelled", { runId });
}

export async function retryTask(taskId: string) {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_tasks WHERE id = ?", args: [taskId] });
  if (!r.rows[0]) throw new Error("task not found");
  const t = rowToTask(r.rows[0]);
  await updateTask(taskId, { status: "pending", attempts: 0, error: null, output: null });
  // tasks skipped because of this one should come back also
  const all = await getTasks(t.runId);
  for (const x of all) if (x.status == "skipped") await updateTask(x.id, { status: "pending", error: null });
  await setRunStatus(t.runId, "running");
  await audit("user", "task_retry", { taskId });
  void executeRun(t.runId);
}

export async function cancelTask(taskId: string) {
  await updateTask(taskId, { status: "cancelled", finishedAt: now() });
  await audit("user", "task_cancelled", { taskId });
}

// new instruction in the middle of a run (interruption). plan extra tasks and reopen final
export async function addInstruction(runId: string, text: string) {
  const run = await getRun(runId);
  if (!run) throw new Error("run not found");
  const tasks = run.tasks || [];
  const bots = await membersFor(run.roomId);
  const plan = await makePlan(text + "\n\n(This is an update to: " + run.instruction + ")", bots, tasks.length + 1, false);
  const ids: string[] = [];
  for (const t of plan.tasks) {
    const id = runId + "-" + t.key + "u";
    ids.push(id);
    await insertTask(runId, { ...t, id, dependsOn: t.dependsOn.map((d) => runId + "-" + d + "u") });
  }
  const final = [...tasks].reverse().find((t) => t.title.toLowerCase().startsWith("consolidate"));
  if (final) {
    await updateTask(final.id, { status: "pending", attempts: 0, output: null, dependsOn: [...final.dependsOn, ...ids] });
  }
  await (await db()).execute({ sql: "UPDATE wf_runs SET instruction = ?, status = 'running', updated_at = ? WHERE id = ?", args: [run.instruction + "\n\nUPDATE: " + text, now(), runId] });
  await audit("user", "run_updated", { runId, text: text.slice(0, 200) });
  await notice(await conversationFor(run), `🔁 New instruction added to \`${runId}\`: _${text.slice(0, 200)}_\nAdded ${ids.length} task(s), final report will be redone.`);
  void executeRun(runId);
}

// called once on boot
export async function recoverRuns() {
  const r = await (await db()).execute("SELECT id FROM wf_runs WHERE status IN ('running','planning')");
  for (const row of r.rows) {
    const id = String(row.id);
    const tasks = await getTasks(id);
    for (const t of tasks) {
      // running -> restart. waiting_approval also needs pending otherwise nobody waits for the approval after restart (found this bug in testing)
      // the approval id is kept in task.error so it reuses the same approval
      if (t.status == "running" || t.status == "waiting_approval") await updateTask(t.id, { status: "pending" });
    }
    await audit("system", "run_recovered_after_restart", { id });
    console.log("[engine] recovering run", id);
    void executeRun(id);
  }
}
