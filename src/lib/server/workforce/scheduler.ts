// scheduled workflows. simple interval check every 30 sec (no cron library)
import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { Workflow } from "@/lib/shared/types";
import { startRun, getRun, notice, conversationFor } from "./taskEngine";
import { audit } from "./approvals";

async function reportFailure(workflowId: string, run: any, err: string | null) {
  try {
    const r = await (await db()).execute({ sql: "SELECT name FROM wf_workflows WHERE id = ?", args: [workflowId] });
    const name = r.rows[0] ? String(r.rows[0].name) : workflowId;
    const failed = (run.tasks || []).filter((t: any) => ["failed", "skipped", "rejected"].includes(t.status));
    let msg = `⏰ Scheduled workflow **${name}** finished as **${run.status}** (run \`${run.id}\`).\n`;
    if (err) msg += `\nFirst error: ${err}\n`;
    if (failed.length) msg += `\nTasks not completed: ${failed.map((t: any) => t.title + " (" + t.status + ")").join(", ")}\n`;
    msg += `\nYou can retry the failed task from Workforce → Runs → ${run.id}.`;
    await notice(await conversationFor(run), msg);
  } catch (e) {
    console.log("[scheduler] could not report failure", e);
  }
}

const g = globalThis as any;

function rowToWf(r: any): Workflow {
  return {
    id: String(r.id),
    name: String(r.name),
    instruction: String(r.instruction),
    roomId: r.room_id,
    everyMinutes: Number(r.every_minutes),
    paused: Number(r.paused) == 1,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdAt: String(r.created_at),
  };
}

export async function listWorkflows() {
  const r = await (await db()).execute("SELECT * FROM wf_workflows ORDER BY created_at");
  const list: any[] = r.rows.map(rowToWf);
  for (const w of list) {
    const h = await (await db()).execute({ sql: "SELECT * FROM wf_workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20", args: [w.id] });
    w.history = h.rows;
  }
  return list;
}

export async function createWorkflow(name: string, instruction: string, roomId: string | null, everyMinutes: number, paused = false) {
  if (!name || !instruction) throw new Error("name and instruction required");
  if (!everyMinutes || everyMinutes < 1) everyMinutes = 60;
  const id = "wf-" + randomUUID().slice(0, 6);
  const next = new Date(Date.now() + everyMinutes * 60000).toISOString();
  await (await db()).execute({
    sql: "INSERT INTO wf_workflows (id, name, instruction, room_id, every_minutes, paused, next_run_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
    args: [id, name, instruction, roomId, everyMinutes, paused ? 1 : 0, next, new Date().toISOString()],
  });
  return id;
}

export async function setPaused(id: string, paused: boolean) {
  await (await db()).execute({ sql: "UPDATE wf_workflows SET paused = ? WHERE id = ?", args: [paused ? 1 : 0, id] });
  await audit("user", paused ? "workflow_paused" : "workflow_resumed", { id });
}

export async function deleteWorkflow(id: string) {
  await (await db()).execute({ sql: "DELETE FROM wf_workflows WHERE id = ?", args: [id] });
}

export async function runWorkflowNow(id: string, manual = true) {
  const r = await (await db()).execute({ sql: "SELECT * FROM wf_workflows WHERE id = ?", args: [id] });
  if (!r.rows[0]) throw new Error("workflow not found");
  const w = rowToWf(r.rows[0]);
  const wrId = "wr-" + randomUUID().slice(0, 6);
  const started = new Date().toISOString();
  await (await db()).execute({
    sql: "UPDATE wf_workflows SET last_run_at = ?, next_run_at = ? WHERE id = ?",
    args: [started, new Date(Date.now() + w.everyMinutes * 60000).toISOString(), id],
  });
  try {
    const runId = await startRun(w.instruction, w.roomId, w.id);
    await (await db()).execute({
      sql: "INSERT INTO wf_workflow_runs (id, workflow_id, run_id, status, started_at) VALUES (?,?,?,?,?)",
      args: [wrId, id, runId, "running", started],
    });
    await audit(manual ? "user" : "scheduler", "workflow_triggered", { id, runId });
    return runId;
  } catch (e: any) {
    await (await db()).execute({
      sql: "INSERT INTO wf_workflow_runs (id, workflow_id, run_id, status, started_at, finished_at, error) VALUES (?,?,?,?,?,?,?)",
      args: [wrId, id, null, "failed", started, new Date().toISOString(), String(e.message || e)],
    });
    throw e;
  }
}

// sync workflow_runs status with the real run status
async function syncHistory() {
  const r = await (await db()).execute("SELECT * FROM wf_workflow_runs WHERE status = 'running'");
  for (const row of r.rows) {
    const run = await getRun(String(row.run_id));
    if (!run) continue;
    if (["done", "failed", "partial", "cancelled"].includes(run.status)) {
      const failedTask = (run.tasks || []).find((t) => t.status == "failed");
      const err = failedTask ? failedTask.title + ": " + failedTask.error : null;
      await (await db()).execute({
        sql: "UPDATE wf_workflow_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?",
        args: [run.status, run.updatedAt, err, String(row.id)],
      });
      // failure reporting - tell the user, dont just leave it in the table
      if (run.status != "done") {
        await audit("scheduler", "workflow_run_" + run.status, { workflow: String(row.workflow_id), runId: run.id, error: err });
        await reportFailure(String(row.workflow_id), run, err);
      }
    }
  }
}

async function tick() {
  try {
    await syncHistory();
    const r = await (await db()).execute("SELECT * FROM wf_workflows WHERE paused = 0");
    for (const row of r.rows) {
      const w = rowToWf(row);
      if (w.nextRunAt && new Date(w.nextRunAt).getTime() <= Date.now()) {
        console.log("[scheduler] running", w.name);
        await runWorkflowNow(w.id, false).catch((e) => console.log("[scheduler] failed", e));
      }
    }
  } catch (e) {
    console.log("[scheduler] tick error", e);
  }
}

export function startScheduler() {
  if (g.__wfScheduler) return;
  g.__wfScheduler = setInterval(tick, 30000);
  console.log("[scheduler] started");
}
