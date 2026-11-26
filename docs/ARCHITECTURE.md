# Architecture

## Overview

```
 User (Workforce page / room chat "/plan ...")
        |
        v
 /api/workforce  ----------------------------->  approvals / memory / skills / workflows
        |
        v
 Chief of Staff (chiefOfStaff.ts)
   - LLM plan (JSON) or rule based plan
   - picks agent by role (title/description/skills)
        |
        v
 Task Engine (taskEngine.ts)  <---- scheduler.ts (every 30s checks workflows)
   loop:
     - find ready tasks (all deps done)
     - run up to 3 in parallel
     - each task:
         read action? (csv / github)  -> real data added to prompt
         external action? -> permission check -> approval centre -> execute or NOT
         else -> runTurn() of original runtime (Mastra agent with tools + memory)
         retry x3 with fallback model, timeout
         parse "DELEGATE @x:" -> new task (depth <= 2)
     - consolidation task by Chief
   -> final report (db + data/reports/*.md) + HISTORY.md + room memory
        |
        v
 Original OpenCrewBot runtime (runtime.ts) -> Mastra Agent -> model (Nebius/OpenAI/Ollama/mock)
```

## Storage

Same SQLite file as original (`data/opencrewbot.db`), new tables:

- `wf_runs` - one row per instruction
- `wf_tasks` - plan tasks (status, deps, attempts, output, tokens, cost...)
- `wf_approvals` - approval requests
- `wf_audit` - audit log
- `wf_workflows`, `wf_workflow_runs` - schedules + history

Memory is markdown files (not db) so user can edit them:

```
data/workspaces/<botId>/MEMORY.md        agent memory (original)
data/workspaces/_rooms/<roomId>/MEMORY.md room memory
data/memory/USER.md                       user preferences
data/memory/PROJECT.md                    project memory
data/memory/DECISIONS.md                  decisions
data/memory/HISTORY.md                    past runs
```

USER/PROJECT/DECISIONS are added to every agent's system prompt (prompt.ts). The prompt is rebuilt on every model call so editing the file changes the next answer, no restart needed.

## Permissions

| Level | Chat tools (mcp/browser) | Workforce external actions |
|---|---|---|
| Ask First | always ask | always approval |
| Controlled | tools in `allowedActions` allowed, rest ask | allowed if in `allowedActions` and under `maxActionsPerRun`, else approval |
| Full | allowed | allowed |

Rejected / not approved in 30 min = task status `rejected`, `executeExternal()` is never called, audit gets `action_not_executed`.

Secrets: only from `.env`, never saved in db, not returned by api (models endpoint only returns provider names). Memory writes go through the original `redactSecrets()`.

## Recovery

On server start (`boot()` in service.ts) `recoverRuns()` finds runs with status running, puts running / waiting_approval tasks back to pending and starts the loop again. Approval id is stored on the task so the same approval is reused.

## Design decisions

- **Reuse original runtime** for agent turns instead of new agent code, so agents keep their tools, MCP connections, memory and chat approvals. Task messages show in the room chat.
- **One API route** with `what` / `action` param. Simpler for me than 15 route files.
- **Polling** in dashboard instead of SSE, the original SSE bus has fixed event types and polling was faster to build.
- **Rule based planner** so the whole flow works in mock mode without any key (needed for the assignment mock mode requirement).
