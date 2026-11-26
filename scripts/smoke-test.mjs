// quick test script. run app first (pnpm dev) then: node scripts/smoke-test.mjs
// it tests the main flows against the running app and prints PASS/FAIL
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;

async function get(what, id = "") {
  return (await fetch(`${BASE}/api/workforce?what=${what}&id=${encodeURIComponent(id)}`)).json();
}
async function post(data) {
  return (await fetch(`${BASE}/api/workforce`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })).json();
}
function check(name, ok, extra = "") {
  if (ok) pass++; else fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  -> " + extra : ""));
}
async function waitRun(id, maxSec = 120, until = ["done", "failed", "partial", "cancelled"]) {
  for (let i = 0; i < maxSec; i++) {
    const r = (await get("run", id)).run;
    if (until.includes(r.status)) return r;
    await sleep(1000);
  }
  return (await get("run", id)).run;
}

const boot = await (await fetch(BASE + "/api/bootstrap")).json();
check("at least 8 agents", boot.bots.length >= 8, boot.bots.length + " agents");
check("at least 4 rooms", boot.rooms.length >= 4, boot.rooms.length + " rooms");
const skills = (await get("skills")).skills;
check("at least 8 skills", skills.length >= 8, skills.length + " skills");

// demo 3 - spreadsheet + parallel
const biz = boot.rooms.find((r) => r.name == "Biz Analysis");
let j = await post({ action: "start-run", instruction: "Analyse the sales spreadsheet, find conversion bottlenecks and revenue opportunities", roomId: biz?.id });
let run = await waitRun(j.runId);
check("demo3 run finished", run.status == "done", run.status);
const csvTask = run.tasks.find((t) => t.action?.type == "analyze_csv");
check("demo3 real csv numbers in output", csvTask?.output?.includes("Biggest bottleneck"), "");
check("demo3 final report exists", (run.finalOutput || "").includes("Final deliverable"));

// demo 1 - parallel research tasks
const intel = boot.rooms.find((r) => r.name == "Market Intel");
j = await post({ action: "start-run", instruction: "Research the competitive landscape for MeetUniversity", roomId: intel?.id });
run = await waitRun(j.runId);
const r1 = run.tasks[0], r2 = run.tasks[1];
check("demo1 two research tasks have no deps (parallel)", r1.dependsOn.length == 0 && r2.dependsOn.length == 0);
check("demo1 parallel start times overlap", r1.startedAt && r2.startedAt && Math.abs(new Date(r1.startedAt) - new Date(r2.startedAt)) < 3000, r1.startedAt + " / " + r2.startedAt);
check("demo1 run done", run.status == "done", run.status);

// demo 7 - reject external action
const dev = boot.rooms.find((r) => r.name == "Dev Team");
j = await post({ action: "start-run", instruction: "Inspect the github repository Studio1-OSS/OpenCrewBot and prepare a development plan", roomId: dev?.id });
let ap = null;
for (let i = 0; i < 90 && !ap; i++) {
  ap = (await get("approvals")).approvals.find((a) => a.runId == j.runId && a.status == "pending");
  if (!ap) await sleep(1000);
}
check("demo7 approval request created", Boolean(ap), ap?.actionType);
if (ap) await post({ action: "decide-approval", id: ap.id, approve: false });
run = await waitRun(j.runId);
const issueTask = run.tasks.find((t) => t.action?.type == "github_issue");
check("demo7 rejected task not executed", issueTask?.status == "rejected", issueTask?.status);
const audit = (await get("audit")).audit;
check("demo7 audit has action_not_executed", audit.some((a) => a.what == "action_not_executed"));
check("demo7 no action_executed for that task", !audit.some((a) => a.what == "action_executed" && String(a.details).includes(issueTask?.id)));

// collaboration (module C) - agents ask / verify / challenge each other
j = await post({ action: "start-run", instruction: "Research the competitive landscape for MeetUniversity", roomId: intel?.id });
run = await waitRun(j.runId);
const extra = run.tasks.filter((t) => t.parentId);
check("collab: agents created follow-up tasks for each other", extra.length >= 2, extra.length + " extra tasks");
check("collab: a question task exists", extra.some((t) => t.title.startsWith("Question from")));
check("collab: a challenge was raised and reviewed", extra.some((t) => t.title.startsWith("Challenge from")));
check("collab: no deadlock, run still finished", run.status == "done", run.status);
check("collab: delegation depth capped at 2", Math.max(...run.tasks.map((t) => t.depth)) <= 2);
const au = (await get("audit")).audit;
check("collab: loop guard logged or depth respected", true, au.filter((a) => a.what == "collaboration_blocked").length + " blocked");

// memory edit
await post({ action: "save-memory", scope: "user", content: "# User preferences\n\n- Reports should be in bullet points _(test · by user · why: smoke test)_\n" });
const mem = await get("memory-file", "user");
check("memory file saved", mem.content.includes("bullet points"));

// workflow
const wfs = (await get("workflows")).workflows;
check("seeded workflow exists", wfs.length >= 1);
j = await post({ action: "workflow-run", id: wfs[0].id });
run = await waitRun(j.runId);
await sleep(31000); // scheduler sync every 30s
const wf2 = (await get("workflows")).workflows[0];
check("workflow history recorded", wf2.history.length >= 1 && wf2.history[0].status != "running", wf2.history[0]?.status);

// cancel
j = await post({ action: "start-run", instruction: "Create a marketing campaign targeting Class 11 students", roomId: null });
await sleep(1500);
await post({ action: "cancel-run", runId: j.runId });
run = await waitRun(j.runId, 10);
check("cancel works", run.status == "cancelled", run.status);

// agent factory
const g = await post({ action: "generate-agent", text: "Create a lead generation agent called Hunter that finds schools for partnerships, controlled access" });
check("agent factory generates", g.bot?.name == "Hunter" && g.bot?.approval == "controlled", JSON.stringify({ name: g.bot?.name, approval: g.bot?.approval, skills: g.bot?.skills }));
const c = await post({ action: "create-agent", bot: g.bot });
const boot2 = await (await fetch(BASE + "/api/bootstrap")).json();
check("new agent available without code change", boot2.bots.some((b) => b.id == c.bot?.id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
