// one api route for all workforce stuff (GET ?what=..., POST {action: ...})
// i know its not the cleanest, but easier to manage than 15 route files
import { handle, body } from "@/lib/server/http";
import { InputError, createBot } from "@/lib/server/service";
import { listRuns, getRun, startRun, cancelRun, retryTask, cancelTask, addInstruction } from "@/lib/server/workforce/taskEngine";
import { listApprovals, decideApproval, listAudit } from "@/lib/server/workforce/approvals";
import { respondToApproval } from "@/lib/server/runtime";
import { listSkills, saveSkill, TOOL_CATALOG, ACTION_CATALOG } from "@/lib/server/workforce/skills";
import { listMemoryFiles, readScope, writeScope } from "@/lib/server/workforce/sharedMemory";
import { listWorkflows, createWorkflow, setPaused, runWorkflowNow, deleteWorkflow } from "@/lib/server/workforce/scheduler";
import { integrationStatus } from "@/lib/server/workforce/integrations";
import { generateAgent } from "@/lib/server/workforce/agentFactory";
import { getProviders, modelForKind, fallbackModel } from "@/lib/server/workforce/llm";
import { isMock } from "@/lib/server/config";
import { listBots } from "@/lib/server/db";
import { mcpServerNames } from "@/lib/server/connectors";
import { publish } from "@/lib/server/bus";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const what = url.searchParams.get("what");
  const id = url.searchParams.get("id") || "";
  return handle(async () => {
    switch (what) {
      case "runs":
        return { runs: await listRuns() };
      case "run":
        return { run: await getRun(id) };
      case "approvals":
        return { approvals: await listApprovals() };
      case "audit":
        return { audit: await listAudit() };
      case "skills": {
        const bots = await listBots();
        return {
          skills: listSkills(),
          tools: TOOL_CATALOG.map((t) => ({ ...t, usedBy: bots.filter((b) => (b.tools as any)[t.id]).map((b) => b.name) })),
          actions: ACTION_CATALOG,
          mcpServers: [...mcpServerNames.values()],
        };
      }
      case "memory":
        return { files: await listMemoryFiles() };
      case "memory-file":
        return { scope: id, content: readScope(id) };
      case "workflows":
        return { workflows: await listWorkflows() };
      case "integrations":
        return { integrations: integrationStatus(), mock: isMock() };
      case "models":
        return {
          mock: isMock(),
          providers: getProviders().map((p) => ({ name: p.name, baseUrl: p.baseUrl, local: p.local })), // no keys!
          routes: ["planning", "research", "writing", "analysis", "code", "summary"].map((k) => ({ kind: k, model: modelForKind(k) })),
          fallback: fallbackModel(),
          routingOn: process.env.TASK_MODEL_ROUTING == "1",
        };
      default:
        throw new InputError("unknown what=" + what);
    }
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const b: any = await body(request);
    switch (b.action) {
      case "start-run":
        return { runId: await startRun(String(b.instruction || ""), b.roomId || null) };
      case "cancel-run":
        await cancelRun(b.runId);
        return { ok: true };
      case "add-instruction":
        await addInstruction(b.runId, String(b.text || ""));
        return { ok: true };
      case "retry-task":
        await retryTask(b.taskId);
        return { ok: true };
      case "cancel-task":
        await cancelTask(b.taskId);
        return { ok: true };
      case "decide-approval":
        if (String(b.id).startsWith("chat-")) {
          // approval from a normal chat (original app's flow)
          await respondToApproval(b.conversationId, b.agentId, b.toolCallId, Boolean(b.approve));
        } else {
          await decideApproval(b.id, Boolean(b.approve));
        }
        return { ok: true };
      case "save-memory":
        writeScope(String(b.scope), String(b.content ?? ""));
        if (String(b.scope).startsWith("bot:")) publish({ type: "memory-changed", botId: String(b.scope).slice(4) });
        return { ok: true };
      case "save-skill":
        return { id: saveSkill(String(b.id), String(b.content)) };
      case "generate-agent":
        return await generateAgent(String(b.text || ""));
      case "create-agent":
        return { bot: await createBot(b.bot) };
      case "create-workflow":
        return { id: await createWorkflow(b.name, b.instruction, b.roomId || null, Number(b.everyMinutes)) };
      case "workflow-run":
        return { runId: await runWorkflowNow(b.id) };
      case "workflow-pause":
        await setPaused(b.id, Boolean(b.paused));
        return { ok: true };
      case "workflow-delete":
        await deleteWorkflow(b.id);
        return { ok: true };
      default:
        throw new InputError("unknown action " + b.action);
    }
  });
}
