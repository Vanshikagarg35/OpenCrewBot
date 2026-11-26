# Test results

By Vanshika Garg.

Environment: Ubuntu, Node 22.23.5, pnpm 11.21, **mock mode** (OPENCREWBOT_MOCK_MODE=1, no GITHUB_TOKEN), fresh data folder.

Command: `node scripts/smoke-test.mjs` with `pnpm dev` running.

```
PASS at least 8 agents  -> 9 agents
PASS at least 4 rooms  -> 5 rooms
PASS at least 8 skills  -> 9 skills
PASS demo3 run finished  -> done
PASS demo3 real csv numbers in output
PASS demo3 final report exists
PASS demo1 two research tasks have no deps (parallel)
PASS demo1 parallel start times overlap  -> 2026-11-26T06:39:46.698Z / 2026-11-26T06:39:46.698Z
PASS demo1 run done  -> done
PASS demo7 approval request created  -> github_issue
PASS demo7 rejected task not executed  -> rejected
PASS demo7 audit has action_not_executed
PASS demo7 no action_executed for that task
PASS collab: agents created follow-up tasks for each other  -> 4 extra tasks
PASS collab: a question task exists
PASS collab: a challenge was raised and reviewed
PASS collab: no deadlock, run still finished  -> done
PASS collab: delegation depth capped at 2
PASS collab: loop guard logged or depth respected  -> 2 blocked
PASS memory file saved
PASS seeded workflow exists
PASS workflow history recorded  -> done
PASS cancel works  -> cancelled
PASS agent factory generates  -> {"name":"Hunter","approval":"controlled","skills":["lead-generation"]}
PASS new agent available without code change

25 passed, 0 failed
```

## Restart / recovery test (manual)

1. Started demo 4 (GitHub) with no room. Tasks t1, t2 done, t3 (create GitHub issue) `waiting_approval`.
2. Stopped the server (Ctrl+C) and started again.
3. Log showed `[engine] recovering run run-2923b7`.
4. Approved the request in Approval centre -> t3 ran -> output `[MOCK] GITHUB_TOKEN not set, issue NOT created` -> consolidation ran -> run `done`.
5. USER.md edited before restart was still there after restart.

First time I did this test it failed - t3 stayed waiting forever after restart. Fixed in commit "fixed recovery after restart for tasks waiting approval".

## Bugs found while testing

- word "report" matched my `repo` regex so a competitor monitoring run also planned GitHub tasks (fixed with `\brepo\b`)
- Chief picking was matching "lead" inside Scout's `lead-generation` skill, so Scout got the consolidation task (fixed: match title first)
- tables not created on hot reload because SCHEMA_VERSION was not bumped (fixed)
- deadlock: the consolidation task asked a teammate for verification, so the new task was waiting for consolidation and consolidation was waiting for the new task. Both ended up skipped and the run said failed. Fixed by not letting the final task ask anyone, plus a guard in reopenFinal
- the mock model was putting CHALLENGE on challenge-handling tasks too, so Verity challenged Byte and Byte challenged Verity back. Depth limit stopped it but it looked silly, so the mock only challenges real verify tasks now
