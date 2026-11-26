# Submission checklist

Submitted by: **Vanshika Garg**

## Acceptance criteria (section 7)

| Requirement | Minimum | Mine | Where to check |
|---|---|---|---|
| Configurable agents | 8 | 9 | Workforce → Agents |
| Collaboration rooms | 4 | 5 | sidebar |
| Dynamic agent creation | Working | ✅ | Workforce → Agents |
| Parallel task execution | Working | ✅ | run page, start times of t1/t2 are same |
| Persistent individual memory | Working | ✅ | Memory tab → agent files |
| Shared project memory | Working | ✅ | Memory tab → PROJECT.md |
| Reusable skills | 8 | 9 | Skills & Tools tab |
| Working integrations | 3 | 4 live (GitHub, Slack, MCP/Composio, CSV) | Integrations tab |
| Permission levels | 3 | 3 (Ask / Controlled / Full) | agent settings |
| Scheduled workflows | Working | ✅ | Workflows tab |
| Approval centre | Working | ✅ | Approvals tab |
| Execution history | Working | ✅ | Runs tab |
| Failure recovery | Demonstrated | ✅ | docs/TEST_RESULTS.md |
| Business demonstrations | 7 | 7 runnable | see below |

## Deliverables (section 8)

| Deliverable | Status |
|---|---|
| Working application | ✅ runs locally, `pnpm dev` |
| Live URL | ❌ not deployed, local only |
| Forked GitHub repo | ⬜ **I have to push it** |
| README + technical documentation | ✅ README.md |
| Architecture documentation | ✅ docs/ARCHITECTURE.md |
| Feature audit (original vs new) | ✅ docs/FEATURE_AUDIT.md |
| 5-10 min screen recorded demo | ⬜ **I have to record it** |
| Test results and evidence | ✅ docs/TEST_RESULTS.md (25/25), evidence folder to be filled after running with a real key |
| Live vs mocked list | ✅ in README |
| Cost / dependency breakdown | ✅ in README |
| Known limitations | ✅ in README |
| MIT licence retained + attribution | ✅ LICENSE untouched, original README kept |

## Before submitting - my own todo

1. Put a real `NEBIUS_API_KEY` (or `OPENAI_API_KEY`) in `.env`, otherwise agent text is placeholder
2. Optional for more real output: `TAVILY_API_KEY` (web search), `GITHUB_TOKEN` (create issue), `SLACK_WEBHOOK_URL` (slack post)
3. Run all 7 demos with the key and save each report into `docs/evidence/`
4. Record the demo video
5. Push to my fork

## Automatic disqualification list (section 11) - how this submission stands

| Disqualifier | Status |
|---|---|
| Built a fresh app instead of extending | No. Fork of Studio1-OSS/OpenCrewBot, original runtime/rooms/memory/tools all reused |
| Only changed branding or interface | No. ~3700 lines of new backend logic |
| Multiple chatbots with no real collaboration | No. Agents delegate, ask, verify and challenge each other, each becomes a tracked task |
| Hard-coded demonstrations | No. Same engine runs any instruction. CSV and GitHub data are read live |
| No persistent memory | No. Markdown files survive restart (tested) |
| No working execution engine | No. Tasks with deps, parallel, retry, timeout, cancel, recovery |
| Fabricated live integrations | No. Every integration is labelled LIVE or MOCK in the UI and README. Gmail is clearly mock |
| No approval enforcement | No. Rejected actions never execute, audit log proves it |
| No failure handling | No. Retry with backoff + fallback model, skip of dependents, recovery after restart |
