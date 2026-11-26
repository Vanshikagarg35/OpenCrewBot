# OpenCrewBot - AI Workforce (assignment submission)

This is my fork of [Studio1-OSS/OpenCrewBot](https://github.com/Studio1-OSS/OpenCrewBot) (MIT licence). I extended it from a "team of chat bots" app into a small **AI workforce**: you give one instruction, a Chief of Staff plans it into tasks, agents run them (parallel where possible), external actions wait for approval, and you get one final report.

Original README is kept at [docs/ORIGINAL_README.md](docs/ORIGINAL_README.md). Original licence + attribution is kept in [LICENSE](LICENSE).

## What I added

| Module | What is done | Where |
|---|---|---|
| A - Chief of Staff | Breaks instruction into tasks, picks agents by role, sets dependencies, consolidates result. LLM planner + rule based fallback for mock mode | `src/lib/server/workforce/chiefOfStaff.ts` |
| B - Agent factory | Describe an agent in plain english -> config (name, role, instructions, model, skills, permissions, output format) -> review JSON -> create. Available instantly, no code change | `agentFactory.ts`, Workforce → Agents |
| C - Collaboration | Rooms (from original) + task outputs passed to dependent agents, `DELEGATE @handle:` creates follow up task, reviewer agent challenges results. Max delegation depth 2 and max 20 tasks per run so no infinite loop | `taskEngine.ts` |
| D - Execution engine | Task plan with id, agent, deps, status, start/end time, output, error, approval flag. Retry (3 tries with backoff + fallback model), timeout, cancel run/task, retry task, recovery after restart, history | `taskEngine.ts`, Workforce → Runs |
| E - Memory | Original per-agent MEMORY.md + new USER.md, PROJECT.md, DECISIONS.md, HISTORY.md and room memory. All markdown, editable in UI or any editor. Every line has provenance (when, who, why) | `sharedMemory.ts`, Workforce → Memory |
| F - Skills | 9 skills as markdown files in `/skills`. Picked automatically by keyword match with the task. Add a new .md file = new skill | `skills.ts` |
| G - Approvals | 3 levels: Ask First, Controlled (pre-approved actions + limit per run), Full. Approval centre with preview + approve/reject, audit log. Rejected = never executed | `approvals.ts`, Workforce → Approvals |
| H - Integrations | GitHub REST (live), Slack webhook (live if webhook set), MCP/Composio (from original), CSV analysis (live). Gmail is MOCK and labelled | `integrations.ts` |
| I - Scheduled workflows | Interval scheduler, run now, pause/resume, history, failure shown in history | `scheduler.ts`, Workforce → Workflows |
| J - Multi model | Nebius (original), OpenAI, Ollama (local). Per agent model, fallback model, task based routing (optional), token + cost tracking per task/run | `llm.ts`, `runtime.ts` |

Seeded: **9 agents** (Scout, Quill, Atlas from original + Chief, Ledger, Pixel, Byte, Verity, Relay), **5 rooms** (Studio + Market Intel, Growth Lab, Biz Analysis, Dev Team), **9 skills**, 1 weekly workflow.

## Setup

Tested on: Ubuntu, Node 22.23, pnpm 11. (Node >= 22.13 needed by original project)

```bash
git clone <this repo>
cd OpenCrewBot
pnpm install
cp .env.example .env   # all keys optional
pnpm dev
```

Open http://localhost:3000 → click **⚡ Workforce** in bottom left of sidebar (or go to http://localhost:3000/workforce).

**No keys = mock mode.** Everything works (planning, tasks, approvals, memory, scheduler) but agent text is placeholder. Real data parts (CSV analysis, GitHub repo info) are still real even in mock mode. To get real agents add any one of `NEBIUS_API_KEY`, `OPENAI_API_KEY` or `OLLAMA_BASE_URL` in `.env` and restart.

## How to use

1. Workforce → Runs → type instruction (or click demo 1-4) → choose a room → Start
2. Plan shows as table in the room chat also. Click run to see tasks live
3. If a task needs approval go to **Approvals** tab → Approve / Reject
4. Final report at bottom of run page (download as .md). Also saved in `data/reports/`
5. You can interrupt a running run with a new instruction (input box on run page)
6. In any room you can also type `/plan <instruction>`

## Business demos (MeetUniversity)

| # | Demo | How to run | Status |
|---|---|---|---|
| 1 | Market intelligence | demo 1 button, room Market Intel | works. 2 research tasks run in parallel → comparison → verify → consolidate. Real research needs model + Tavily key |
| 2 | Marketing campaign (Class 11, Aspirations) | demo 2, room Growth Lab | works, audience → strategy → content calendar |
| 3 | Business analysis | demo 3, room Biz Analysis | works with **real calculations** on `samples/sales_sample.csv` (funnel, bottleneck, segment tables, text bar charts) |
| 4 | Development team | demo 4, room Dev Team | real GitHub inspection (repo info, files, issues). Create issue waits for approval |
| 5 | Autonomous routine | Workflows tab → "Weekly competitor monitoring" → Run now | history + report |
| 6 | Memory | Tell an agent "remember that I want reports in bullet points" or edit USER.md in Memory tab, restart, ask again | persists (files on disk) |
| 7 | Human intervention | demo 4 → reject the GitHub issue approval | task becomes `rejected`, audit log shows `action_not_executed` |

The sample CSV is made up data I generated (240 rows), it is not MeetUniversity's real data.

## Live vs mocked

| Feature | Live / Mock |
|---|---|
| Agent replies | LIVE with model key, MOCK without (labelled `[MOCK OUTPUT]`) |
| Chief of Staff planning | LLM with key, rule based without (shown in plan note) |
| Agent factory | LLM with key, regex parser without |
| CSV analysis | LIVE always (real calculation) |
| GitHub read | LIVE (public repos, token optional) |
| GitHub create issue | LIVE only with `GITHUB_TOKEN`, else mock message, always after approval |
| Slack post | LIVE only with `SLACK_WEBHOOK_URL` |
| Gmail | **MOCK** - nothing is sent |
| Web search | LIVE with `TAVILY_API_KEY` (original app) |
| MCP / Composio | LIVE (original app, Connections panel) |
| Scheduler, approvals, memory, audit | LIVE (local) |

## Costs / dependencies

| Thing | Cost |
|---|---|
| Nebius Token Factory models | pay per token, ~$0.1-$3 per 1M tokens depending model. One demo run is roughly 20-60k tokens so few cents |
| OpenAI (optional) | gpt-4o-mini ~$0.15 / $0.60 per 1M tokens |
| Ollama (optional) | free, runs local |
| Tavily search | free tier 1000 credits/month |
| GitHub API | free (60 req/hour without token) |
| Slack webhook | free |
| Hosting | none, runs local (SQLite + files) |

Cost shown in the app is an estimate from a price table, not exact billing.

All new code uses only packages that were already in the original project (Next.js, Mastra, libsql, react-markdown - MIT/Apache). I did not add any new npm dependency.

## Tests

`node scripts/smoke-test.mjs` (app must be running). Result in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) - 19/19 passed in mock mode.

## Known limitations

- Parallel tasks run in batches of 3. If one task in batch waits for approval the other ready tasks wait for that batch to finish
- Task timeout marks the task failed but does not abort the model call (aborting would stop the whole room conversation)
- Skill picking is keyword based, not semantic
- Rule based planner (mock mode) only knows the demo type of requests, for other things it makes a generic research + write plan
- Dashboard uses polling every 2 sec, not SSE
- Gmail is mock, I didn't get time to do OAuth
- Cost numbers are estimates
- No login (same as original - only works on localhost)
- Didn't deploy, local only

More details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/FEATURE_AUDIT.md](docs/FEATURE_AUDIT.md).
