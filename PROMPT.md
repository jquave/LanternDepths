You are participating in a multi-agent round-robin loop.

## Required reading (do this first)

1. Read `TURN.md` — it names **who you are this turn**, the turn number, instructions, and prior handoffs.
2. Read `GOAL.md` — this is the objective. Everything you do must advance it.

## Required actions this turn

1. **State your name** at the start of your work (as given in `TURN.md`, e.g. Grok, Codex, or Claude).
2. Assess progress against `GOAL.md`. Prefer concrete file/repo changes over discussion-only turns.
3. Make meaningful progress toward the goal. Do not redo the previous agent's completed work unless fixing a real problem.
4. Before finishing, **update `TURN.md`** so the next agent can continue:
   - Confirm your agent name
   - Summarize **what you changed** (files touched, decisions made)
   - Note current status vs `GOAL.md` (done / partial / blocked)
   - Leave clear **handoff notes** for the next agent in the rotation
5. Do **not** stop the loop. Do not delete `TURN.md`, `GOAL.md`, or the orchestrator. Keep working until the goal in `GOAL.md` is fully accomplished; if it is already fully accomplished, say so clearly in `TURN.md` and make only minimal verification/docs polish.

Work in this repository. Prefer small, verifiable steps each turn.
