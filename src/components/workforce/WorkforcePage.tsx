"use client";
// Workforce dashboard. all new screens are here (tasks, approvals, memory, skills, workflows ...)
// polling every 2 sec instead of SSE, simpler

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

async function get(what: string, id = "") {
  const r = await fetch(`/api/workforce?what=${what}&id=${encodeURIComponent(id)}`);
  return r.json();
}
async function post(data: any) {
  const r = await fetch("/api/workforce", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const j = await r.json();
  if (j.error) alert(j.error);
  return j;
}

const TABS = ["Runs", "Approvals", "Agents", "Memory", "Skills & Tools", "Workflows", "Integrations & Models", "Audit log"];

const statusColor: any = {
  done: "bg-green-600",
  running: "bg-blue-600",
  pending: "bg-neutral-600",
  waiting_approval: "bg-yellow-600",
  failed: "bg-red-600",
  rejected: "bg-red-800",
  cancelled: "bg-neutral-700",
  skipped: "bg-neutral-700",
  planning: "bg-purple-600",
  partial: "bg-orange-600",
  approved: "bg-green-600",
};

function Badge({ s }: { s: string }) {
  return <span className={"rounded px-2 py-0.5 text-xs text-white " + (statusColor[s] || "bg-neutral-600")}>{s}</span>;
}

function Md({ text }: { text: string }) {
  return (
    <div className="prose-sm max-w-none text-[13.5px] leading-6 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_code]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export default function WorkforcePage() {
  const [tab, setTab] = useState("Runs");
  const [mock, setMock] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    get("integrations").then((j) => setMock(j.mock));
    const t = setInterval(() => {
      get("approvals").then((j) => setPendingCount((j.approvals || []).filter((a: any) => a.status == "pending").length));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-app text-ink">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <a href="/" className="text-sm text-mute hover:text-ink">← Back to chats</a>
          <h1 className="text-2xl font-bold">⚡ AI Workforce</h1>
          {mock && <span className="rounded bg-warn px-2 py-0.5 text-xs text-black">MOCK MODE - agent text is placeholder</span>}
        </div>
        <div className="mb-5 flex flex-wrap gap-2 border-b border-line pb-2">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={"rounded-lg px-3 py-1.5 text-sm " + (tab == t ? "bg-accent text-white" : "bg-raised hover:bg-hover")}>
              {t}
              {t == "Approvals" && pendingCount > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs">{pendingCount}</span>}
            </button>
          ))}
        </div>
        {tab == "Runs" && <RunsTab />}
        {tab == "Approvals" && <ApprovalsTab />}
        {tab == "Agents" && <AgentsTab />}
        {tab == "Memory" && <MemoryTab />}
        {tab == "Skills & Tools" && <SkillsTab />}
        {tab == "Workflows" && <WorkflowsTab />}
        {tab == "Integrations & Models" && <IntegrationsTab />}
        {tab == "Audit log" && <AuditTab />}
      </div>
    </div>
  );
}

// ---------------- Runs ----------------
function RunsTab() {
  const [runs, setRuns] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [instruction, setInstruction] = useState("");
  const [roomId, setRoomId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => get("runs").then((j) => setRuns(j.runs || []));
  useEffect(() => {
    load();
    fetch("/api/bootstrap").then((r) => r.json()).then((j) => setRooms(j.rooms || []));
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  const start = async () => {
    setLoading(true);
    const j = await post({ action: "start-run", instruction, roomId: roomId || null });
    setLoading(false);
    if (j.runId) {
      setSelected(j.runId);
      setInstruction("");
      load();
    }
  };

  const examples = [
    "Research the competitive landscape for MeetUniversity. Identify competitors, their products, public pricing, target customers, positioning and market opportunities.",
    "Create a marketing campaign targeting Class 11 students for Aspirations with audience research, campaign concepts and a 30-day content calendar.",
    "Analyse the sales spreadsheet, find conversion bottlenecks, segment performance and revenue opportunities, and give recommendations.",
    "Inspect the GitHub repository Studio1-OSS/OpenCrewBot, identify technical issues, recommend improvements and prepare a development plan.",
  ];

  if (selected) return <RunDetail id={selected} onBack={() => setSelected(null)} />;

  return (
    <div>
      <div className="mb-6 rounded-xl bg-raised p-4">
        <h2 className="mb-2 font-semibold">Give the Chief of Staff one instruction</h2>
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} className="w-full rounded-lg bg-app p-2 text-sm ring-1 ring-line" placeholder="e.g. Research our competitors and send summary to slack" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="rounded bg-app px-2 py-1 text-sm ring-1 ring-line">
            <option value="">No room (all agents)</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.emoji} {r.name}</option>
            ))}
          </select>
          <button disabled={loading || !instruction.trim()} onClick={start} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white disabled:opacity-50">
            {loading ? "Planning..." : "Start"}
          </button>
        </div>
        <div className="mt-3 text-xs text-mute">
          Examples:{" "}
          {examples.map((e, i) => (
            <button key={i} onClick={() => setInstruction(e)} className="mr-2 underline hover:text-ink">demo {i + 1}</button>
          ))}
          <span className="ml-2">(tip: you can also type <code>/plan ...</code> in any room)</span>
        </div>
      </div>

      <h2 className="mb-2 font-semibold">Execution history</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-mute">
            <th className="py-1">Run</th>
            <th>Instruction</th>
            <th>Status</th>
            <th>Tasks</th>
            <th>Tokens / cost</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => setSelected(r.id)} className="cursor-pointer border-t border-line hover:bg-hover">
              <td className="py-2 font-mono text-xs">{r.id}{r.workflowId ? " ⏰" : ""}</td>
              <td className="max-w-md truncate pr-2">{r.instruction}</td>
              <td><Badge s={r.status} /></td>
              <td>{r.doneCount}/{r.taskCount}</td>
              <td className="text-xs">{r.tokens} · ${Number(r.cost || 0).toFixed(4)}</td>
              <td className="text-xs text-mute">{new Date(r.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {runs.length == 0 && (
            <tr><td colSpan={6} className="py-4 text-mute">No runs yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<any>(null);
  const [extra, setExtra] = useState("");
  const [showReport, setShowReport] = useState(true);
  const [openTask, setOpenTask] = useState<string | null>(null);

  const load = () => get("run", id).then((j) => setRun(j.run));
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [id]);

  if (!run) return <div>Loading...</div>;
  const tasks = run.tasks || [];
  const tokens = tasks.reduce((s: number, t: any) => s + t.tokensIn + t.tokensOut, 0);
  const cost = tasks.reduce((s: number, t: any) => s + t.cost, 0);

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm text-mute hover:text-ink">← all runs</button>
      <div className="mb-4 rounded-xl bg-raised p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{run.id}</span>
          <Badge s={run.status} />
          <span className="text-xs text-mute">{tokens} tokens · ~${cost.toFixed(4)}</span>
          <div className="ml-auto flex gap-2">
            {(run.status == "running" || run.status == "planning") && (
              <button onClick={() => post({ action: "cancel-run", runId: id }).then(load)} className="rounded bg-danger px-3 py-1 text-xs text-white">Cancel run</button>
            )}
          </div>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{run.instruction}</p>
        <p className="mt-1 text-xs text-mute">{run.planNote}</p>
        <div className="mt-3 flex gap-2">
          <input value={extra} onChange={(e) => setExtra(e.target.value)} className="flex-1 rounded bg-app px-2 py-1 text-sm ring-1 ring-line" placeholder="Interrupt with a new instruction (e.g. also send the summary to slack)" />
          <button disabled={!extra.trim()} onClick={() => post({ action: "add-instruction", runId: id, text: extra }).then(() => { setExtra(""); load(); })} className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-50">Add</button>
        </div>
      </div>

      <h3 className="mb-2 font-semibold">Task plan</h3>
      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="text-left text-mute">
            <th className="py-1">ID</th><th>Task</th><th>Agent</th><th>Depends</th><th>Status</th><th>Try</th><th>Start / end</th><th>Skills</th><th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t: any) => (
            <>
              <tr key={t.id} className="border-t border-line align-top">
                <td className="py-2 font-mono text-xs">{t.id.replace(run.id + "-", "")}</td>
                <td className="pr-2">
                  <button className="text-left hover:underline" onClick={() => setOpenTask(openTask == t.id ? null : t.id)}>{t.title}</button>
                  {t.action && <div className="text-xs text-mute">action: {t.action.type}{t.needsApproval ? " (needs approval)" : ""}</div>}
                  {t.depth > 0 && <div className="text-xs text-mute">delegated (depth {t.depth})</div>}
                </td>
                <td>{t.agentName}</td>
                <td className="font-mono text-xs">{t.dependsOn.map((d: string) => d.replace(run.id + "-", "")).join(", ") || "-"}</td>
                <td><Badge s={t.status} /></td>
                <td className="text-xs">{t.attempts}/{t.maxAttempts}</td>
                <td className="text-xs text-mute">
                  {t.startedAt ? new Date(t.startedAt).toLocaleTimeString() : "-"}<br />{t.finishedAt ? new Date(t.finishedAt).toLocaleTimeString() : ""}
                </td>
                <td className="text-xs">{(t.skills || []).join(", ")}</td>
                <td className="whitespace-nowrap">
                  {["failed", "cancelled", "skipped", "rejected"].includes(t.status) && (
                    <button onClick={() => post({ action: "retry-task", taskId: t.id }).then(load)} className="rounded bg-raised-2 px-2 py-0.5 text-xs">Retry</button>
                  )}
                  {t.status == "pending" && (
                    <button onClick={() => post({ action: "cancel-task", taskId: t.id }).then(load)} className="rounded bg-raised-2 px-2 py-0.5 text-xs">Cancel</button>
                  )}
                </td>
              </tr>
              {openTask == t.id && (
                <tr key={t.id + "-out"}>
                  <td colSpan={9} className="bg-app p-3">
                    {t.error && <p className="mb-2 text-xs text-danger">Error: {t.error}</p>}
                    <p className="mb-1 text-xs text-mute">model: {t.model || "-"} · {t.tokensIn}/{t.tokensOut} tokens</p>
                    <Md text={t.output || "(no output yet)"} />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {run.finalOutput && (
        <div className="rounded-xl bg-raised p-4">
          <div className="mb-2 flex items-center">
            <h3 className="font-semibold">Consolidated deliverable</h3>
            <button onClick={() => setShowReport(!showReport)} className="ml-auto text-xs text-mute">{showReport ? "hide" : "show"}</button>
            <button
              onClick={() => {
                const blob = new Blob([run.finalOutput], { type: "text/markdown" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = run.id + ".md";
                a.click();
              }}
              className="ml-3 text-xs text-accent"
            >
              download .md
            </button>
          </div>
          {showReport && <Md text={run.finalOutput} />}
        </div>
      )}
    </div>
  );
}

// ---------------- Approvals ----------------
function ApprovalsTab() {
  const [list, setList] = useState<any[]>([]);
  const load = () => get("approvals").then((j) => setList(j.approvals || []));
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  const decide = async (a: any, approve: boolean) => {
    await post({ action: "decide-approval", id: a.id, approve, conversationId: a.conversationId, agentId: a.agentId, toolCallId: a.toolCallId });
    load();
  };
  return (
    <div>
      <p className="mb-3 text-sm text-mute">External / sensitive actions wait here. Rejected actions are never executed (check Audit log).</p>
      {list.length == 0 && <p className="text-mute">Nothing here</p>}
      {list.map((a) => (
        <div key={a.id} className="mb-3 rounded-xl bg-raised p-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{a.actionType}</span>
            <Badge s={a.status} />
            <span className="text-xs text-mute">{a.source == "chat" ? "from chat" : "run " + a.runId} · {new Date(a.createdAt).toLocaleString()}</span>
          </div>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-app p-2 text-xs">{a.preview}</pre>
          {a.status == "pending" && (
            <div className="mt-2 flex gap-2">
              <button onClick={() => decide(a, true)} className="rounded bg-green-600 px-3 py-1 text-sm text-white">Approve</button>
              <button onClick={() => decide(a, false)} className="rounded bg-red-600 px-3 py-1 text-sm text-white">Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- Agents (factory) ----------------
function AgentsTab() {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [bots, setBots] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const loadBots = () => fetch("/api/bootstrap").then((r) => r.json()).then((j) => setBots(j.bots || []));
  useEffect(() => {
    loadBots();
  }, []);

  const generate = async () => {
    setMsg("generating...");
    const j = await post({ action: "generate-agent", text });
    setDraft(j.bot ? JSON.stringify(j.bot, null, 2) : null);
    setMsg(j.usedLlm ? "Generated by LLM" : "Generated with rule-based parser (mock mode / no LLM)");
  };
  const create = async () => {
    let parsed;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      alert("JSON is invalid");
      return;
    }
    const j = await post({ action: "create-agent", bot: parsed });
    if (j.bot) {
      setMsg("Created " + j.bot.name + " (@" + j.bot.handle + "). Its available in chats now, no restart needed.");
      setDraft(null);
      setText("");
      loadBots();
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl bg-raised p-4">
        <h2 className="mb-2 font-semibold">Create agent from description</h2>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded bg-app p-2 text-sm ring-1 ring-line" placeholder='e.g. Create a lead generation agent called Hunter that finds schools for partnerships, controlled access, output as table' />
        <button disabled={!text.trim()} onClick={generate} className="mt-2 rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-50">Generate</button>
        <p className="mt-2 text-xs text-mute">{msg}</p>
        {draft && (
          <>
            <p className="mt-3 text-xs text-mute">Review / edit before creating:</p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} className="w-full rounded bg-app p-2 font-mono text-xs ring-1 ring-line" />
            <button onClick={create} className="mt-2 rounded bg-green-600 px-3 py-1 text-sm text-white">Create agent</button>
          </>
        )}
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Agents ({bots.length})</h2>
        {bots.map((b) => (
          <div key={b.id} className="mb-2 rounded-lg bg-raised p-3 text-sm">
            <div className="font-medium">{b.emoji} {b.name} <span className="text-mute">@{b.handle} · {b.title}</span></div>
            <div className="text-xs text-mute">
              permission: <b>{b.approval}</b> · model: {b.model}{b.fallbackModel ? " (fallback " + b.fallbackModel + ")" : ""}
            </div>
            <div className="text-xs text-mute">skills: {(b.skills || []).join(", ") || "-"}{b.allowedActions?.length ? " · pre-approved: " + b.allowedActions.join(", ") : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Memory ----------------
function MemoryTab() {
  const [files, setFiles] = useState<any[]>([]);
  const [scope, setScope] = useState("user");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    get("memory").then((j) => setFiles(j.files || []));
  }, []);
  useEffect(() => {
    get("memory-file", scope).then((j) => setContent(j.content || ""));
    setSaved("");
  }, [scope]);
  const save = async () => {
    await post({ action: "save-memory", scope, content });
    setSaved("Saved at " + new Date().toLocaleTimeString() + ". Agents will use this from next reply.");
  };
  return (
    <div className="flex gap-4">
      <div className="w-64 shrink-0">
        {files.map((f) => (
          <button key={f.scope} onClick={() => setScope(f.scope)} className={"mb-1 block w-full truncate rounded px-2 py-1 text-left text-sm " + (scope == f.scope ? "bg-accent text-white" : "hover:bg-hover")} title={f.path}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1">
        <p className="mb-1 text-xs text-mute">Plain markdown file on disk. Lines have provenance: _(when · by who · why)_</p>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={24} className="w-full rounded bg-app p-2 font-mono text-xs ring-1 ring-line" />
        <button onClick={save} className="mt-2 rounded bg-accent px-3 py-1 text-sm text-white">Save</button>
        <span className="ml-2 text-xs text-ok">{saved}</span>
      </div>
    </div>
  );
}

// ---------------- Skills ----------------
function SkillsTab() {
  const [data, setData] = useState<any>({ skills: [], tools: [], actions: [], mcpServers: [] });
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    get("skills").then(setData);
  }, []);
  return (
    <div>
      <h2 className="mb-1 font-semibold">Skills ({data.skills.length})</h2>
      <p className="mb-3 text-sm text-mute">Skills are markdown files in the <code>/skills</code> folder. Agents load them automatically by matching keywords with the task. Add a new .md file to add a skill, no code change and no restart needed.</p>
      {data.skills.map((s: any) => (
        <div key={s.id} className="mb-2 rounded-lg bg-raised p-3">
          <button onClick={() => setOpen(open == s.id ? null : s.id)} className="font-medium">{s.name}</button>
          <span className="ml-2 text-xs text-mute">{s.kind} · {s.keywords.join(", ")}</span>
          {open == s.id && <div className="mt-2"><Md text={s.body} /></div>}
        </div>
      ))}

      <h2 className="mb-1 mt-6 font-semibold">Agent tools</h2>
      <p className="mb-2 text-sm text-mute">Turn these on/off per agent in the agent settings. Permission level decides which ones need approval.</p>
      <table className="mb-6 w-full text-sm">
        <thead><tr className="text-left text-mute"><th className="py-1">Tool</th><th>Type</th><th>Needs</th><th>Approval</th><th>Enabled for</th></tr></thead>
        <tbody>
          {data.tools.map((t: any) => (
            <tr key={t.id} className="border-t border-line align-top">
              <td className="py-1">{t.name}</td>
              <td className="text-xs">{t.category}</td>
              <td className="font-mono text-xs">{t.needs}</td>
              <td className="text-xs">{t.approval}</td>
              <td className="text-xs">{t.usedBy?.join(", ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-1 font-semibold">Workforce actions</h2>
      <p className="mb-2 text-sm text-mute">These are run by the execution engine, not by the agent. External ones go through the Approval centre.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-mute"><th className="py-1">Action</th><th>External?</th><th>Needs</th><th>Status</th></tr></thead>
        <tbody>
          {data.actions.map((a: any) => (
            <tr key={a.id} className="border-t border-line">
              <td className="py-1 font-mono text-xs">{a.id}</td>
              <td className="text-xs">{a.external ? "yes - needs approval" : "no (read only)"}</td>
              <td className="font-mono text-xs">{a.needs}</td>
              <td><span className={"rounded px-1.5 text-xs " + (a.live ? "bg-green-700" : "bg-yellow-700")}>{a.live ? "LIVE" : "MOCK"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-mute">MCP servers connected: {data.mcpServers?.length ? data.mcpServers.join(", ") : "none yet (add from Connections panel in the main app)"}</p>
    </div>
  );
}

// ---------------- Workflows ----------------
function WorkflowsTab() {
  const [list, setList] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", instruction: "", roomId: "", everyMinutes: 1440 });
  const load = () => get("workflows").then((j) => setList(j.workflows || []));
  useEffect(() => {
    load();
    fetch("/api/bootstrap").then((r) => r.json()).then((j) => setRooms(j.rooms || []));
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <div>
      <div className="mb-5 rounded-xl bg-raised p-4">
        <h2 className="mb-2 font-semibold">New scheduled workflow</h2>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="mb-2 w-full rounded bg-app px-2 py-1 text-sm ring-1 ring-line" />
        <textarea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="Instruction for the Chief of Staff" rows={2} className="mb-2 w-full rounded bg-app px-2 py-1 text-sm ring-1 ring-line" />
        <div className="flex gap-2">
          <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="rounded bg-app px-2 py-1 text-sm ring-1 ring-line">
            <option value="">No room</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={form.everyMinutes} onChange={(e) => setForm({ ...form, everyMinutes: Number(e.target.value) })} className="rounded bg-app px-2 py-1 text-sm ring-1 ring-line">
            <option value={5}>every 5 min (testing)</option>
            <option value={60}>hourly</option>
            <option value={1440}>daily</option>
            <option value={10080}>weekly</option>
          </select>
          <button onClick={() => post({ action: "create-workflow", ...form }).then(load)} className="rounded bg-accent px-3 py-1 text-sm text-white">Create</button>
        </div>
      </div>
      {list.map((w) => (
        <div key={w.id} className="mb-3 rounded-xl bg-raised p-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{w.name}</span>
            {w.paused ? <Badge s="paused" /> : <Badge s="running" />}
            <span className="text-xs text-mute">every {w.everyMinutes} min · next: {w.nextRunAt ? new Date(w.nextRunAt).toLocaleString() : "-"}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => post({ action: "workflow-run", id: w.id }).then(load)} className="rounded bg-accent px-2 py-0.5 text-xs text-white">Run now</button>
              <button onClick={() => post({ action: "workflow-pause", id: w.id, paused: !w.paused }).then(load)} className="rounded bg-raised-2 px-2 py-0.5 text-xs">{w.paused ? "Resume" : "Pause"}</button>
              <button onClick={() => confirm("Delete workflow?") && post({ action: "workflow-delete", id: w.id }).then(load)} className="rounded bg-raised-2 px-2 py-0.5 text-xs">Delete</button>
            </div>
          </div>
          <p className="mt-1 text-sm text-mute">{w.instruction}</p>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="text-left text-mute"><th>Run</th><th>Status</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead>
            <tbody>
              {(w.history || []).map((h: any) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="py-1 font-mono">{h.run_id || "-"}</td>
                  <td><Badge s={h.status} /></td>
                  <td>{h.started_at ? new Date(h.started_at).toLocaleString() : ""}</td>
                  <td>{h.finished_at ? new Date(h.finished_at).toLocaleString() : ""}</td>
                  <td className="text-danger">{h.error || ""}</td>
                </tr>
              ))}
              {(w.history || []).length == 0 && <tr><td colSpan={5} className="py-1 text-mute">no runs yet</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ---------------- Integrations + models ----------------
function IntegrationsTab() {
  const [ints, setInts] = useState<any[]>([]);
  const [models, setModels] = useState<any>(null);
  useEffect(() => {
    get("integrations").then((j) => setInts(j.integrations || []));
    get("models").then(setModels);
  }, []);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h2 className="mb-2 font-semibold">Integrations</h2>
        {ints.map((i) => (
          <div key={i.id} className="mb-2 rounded-lg bg-raised p-3 text-sm">
            <span className="font-medium">{i.name}</span>{" "}
            <span className={"ml-1 rounded px-1.5 text-xs " + (i.live ? "bg-green-700" : "bg-yellow-700")}>{i.live ? "LIVE" : "MOCK"}</span>
            <div className="text-xs text-mute">{i.note}</div>
          </div>
        ))}
        <p className="text-xs text-mute">Composio apps and MCP servers are managed from the Connections panel in the main app.</p>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Models</h2>
        {models && (
          <div className="rounded-lg bg-raised p-3 text-sm">
            <p>Mode: <b>{models.mock ? "MOCK" : "LIVE"}</b></p>
            <p className="mt-1">Providers configured: {models.providers.length ? models.providers.map((p: any) => p.name + (p.local ? " (local)" : " (hosted)")).join(", ") : "none"}</p>
            <p className="mt-1">Fallback model: {models.fallback}</p>
            <p className="mt-1">Task based routing: {models.routingOn ? "ON" : "OFF (set TASK_MODEL_ROUTING=1)"}</p>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {models.routes.map((r: any) => (
                  <tr key={r.kind} className="border-t border-line"><td className="py-1">{r.kind}</td><td>{r.model}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-mute">Each agent's own model is set in its settings (chat view). Use <code>openai:gpt-4o-mini</code> or <code>ollama:llama3.1</code> for other providers.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    get("audit").then((j) => setRows(j.audit || []));
  }, []);
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-mute"><th className="py-1">Time</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-line align-top">
            <td className="py-1 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
            <td>{r.who}</td>
            <td className={String(r.what).includes("not_executed") || String(r.what) == "rejected" ? "text-danger" : ""}>{r.what}</td>
            <td className="font-mono break-all">{r.details}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
