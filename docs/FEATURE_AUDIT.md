# Feature audit - original vs mine

By Vanshika Garg

## What original OpenCrewBot already had

| Feature | State in original |
|---|---|
| Bots with persona, model, tools | Implemented |
| DM chats + group rooms | Implemented |
| Room routing (auto via Jev / lead / everyone / @mention) | Implemented, auto needs TYPESAFE key else falls back to lead |
| Bot to bot handoff by @mention | Implemented, max depth 2 |
| MEMORY.md per bot + memory tools | Implemented |
| Tool approval in chat (Ask / Full) | Implemented, only 2 levels |
| Web search (Tavily), cloud browser (Browserbase), code mode | Implemented, need keys |
| Composio apps + MCP servers | Implemented |
| Mock model | Implemented (scripted replies) |
| Model picker | Nebius only |

Partial / limited in original: no task planning (Mastra task tools were disabled), no execution tracking, no shared memory, no skills, no scheduler, single provider, approvals only inside chat.

## What I built

| Feature | New / extended |
|---|---|
| Chief of Staff planner | New |
| Execution engine (tasks, deps, parallel, retry, timeout, cancel, recovery, history) | New |
| Collaboration: DELEGATE / ASK / VERIFY / CHALLENGE become tracked tasks, 4 loop guards | New (on top of original @mention handoff idea) |
| Agent factory from natural language | New |
| Shared memory (user/project/decisions/history/room) + provenance | Extended original markdown memory |
| `why` field in memory_add, `team_memory_add` tool | Extended |
| Skills system (9 md skills) + Skills & Tools manager | New |
| Controlled Access level + tool level permissions | Extended (`setForTool`) |
| Approval centre (task + chat approvals in one place), audit log | New |
| GitHub, Slack, Gmail(mock), CSV integrations | New (MCP/Composio kept from original) |
| Scheduler + failure reporting | New |
| OpenAI + Ollama providers, fallback model, routing, cost per task | Extended runtime |
| Mock mode task outputs | Extended mock model |
| Workforce dashboard (8 tabs) | New page, linked from original sidebar |
| 6 new agents, 4 new rooms | New seed |
| Smoke test script | New |
