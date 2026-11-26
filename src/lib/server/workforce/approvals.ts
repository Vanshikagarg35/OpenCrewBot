// approval centre + audit log
import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { Approval, Bot } from "@/lib/shared/types";

export async function audit(who: string, what: string, details: any = "") {
  const d = typeof details == "string" ? details : JSON.stringify(details);
  await (await db()).execute({ sql: "INSERT INTO wf_audit (at, who, what, details) VALUES (?,?,?,?)", args: [new Date().toISOString(), who, what, d.slice(0, 2000)] });
}

export async function listAudit(limit = 200) {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_audit ORDER BY id DESC LIMIT ?", args: [limit] });
  return r.rows;
}

function rowToApproval(r: any): Approval {
  return {
    id: String(r.id),
    runId: r.run_id as any,
    taskId: r.task_id as any,
    agentId: r.agent_id as any,
    actionType: String(r.action_type),
    preview: String(r.preview),
    payload: r.payload ? JSON.parse(String(r.payload)) : null,
    status: r.status as any,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at as any,
    source: "task",
  };
}

export async function createApproval(runId: string, taskId: string, agentId: string, actionType: string, preview: string, payload: any) {
  const id = randomUUID().slice(0, 8);
  await (await db()).execute({
    sql: "INSERT INTO wf_approvals (id, run_id, task_id, agent_id, action_type, preview, payload, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [id, runId, taskId, agentId, actionType, preview, JSON.stringify(payload), "pending", new Date().toISOString()],
  });
  await audit(agentId, "approval_requested", { id, actionType, taskId });
  return id;
}

export async function getApproval(id: string) {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_approvals WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToApproval(r.rows[0]) : null;
}

export async function listApprovals(): Promise<Approval[]> {
  const r = await (await db()).execute("SELECT * FROM wf_approvals ORDER BY created_at DESC LIMIT 100");
  const list = r.rows.map(rowToApproval);
  // also show tool approvals waiting inside chats (from original app)
  const m = await (await db()).execute(`SELECT data FROM messages WHERE data LIKE '%"awaiting-approval"%'`);
  for (const row of m.rows) {
    const msg = JSON.parse(String(row.data));
    if (msg.status !== "streaming") continue;
    for (const p of msg.parts) {
      if (p.kind == "tool" && p.status == "awaiting-approval") {
        list.unshift({
          id: "chat-" + p.toolCallId,
          runId: null,
          taskId: null,
          agentId: msg.botId,
          actionType: p.name,
          preview: p.label + (p.detail ? ": " + p.detail : ""),
          payload: null,
          status: "pending",
          createdAt: msg.createdAt,
          decidedAt: null,
          source: "chat",
          conversationId: msg.conversationId,
          toolCallId: p.toolCallId,
        });
      }
    }
  }
  return list;
}

export async function decideApproval(id: string, approve: boolean) {
  const a = await getApproval(id);
  if (!a) throw new Error("approval not found");
  if (a.status != "pending") throw new Error("already " + a.status);
  await (await db()).execute({
    sql: "UPDATE wf_approvals SET status = ?, decided_at = ? WHERE id = ?",
    args: [approve ? "approved" : "rejected", new Date().toISOString(), id],
  });
  await audit("user", approve ? "approved" : "rejected", { id, actionType: a.actionType });
}

// permission check. returns true if action needs a human approval
// ask = always, controlled = only if not in allowedActions or over limit, full = never
export function needsApproval(bot: Bot, actionType: string, usedInRun: number): boolean {
  const level = bot.approval || "ask";
  if (level == "ask") return true;
  if (level == "controlled") {
    const allowed = bot.allowedActions || [];
    const limit = bot.maxActionsPerRun ?? 2;
    if (!allowed.includes(actionType)) return true;
    if (usedInRun >= limit) return true;
    return false;
  }
  return false; // full
}
