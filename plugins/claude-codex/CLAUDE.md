# Claude Code - Multi-Session Orchestrator Pipeline

> **IMPORTANT**: This project uses a **Multi-Session Orchestrator Architecture** with Task + Resume pattern. The orchestrator coordinates specialized worker agents, handles decision escalation, and uses Codex as an independent final gate.

## Path Reference

| Variable | Purpose | Example |
|----------|---------|---------|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin installation directory | `~/.claude/plugins/claude-codex/` |
| `${CLAUDE_PROJECT_DIR}` | Your project directory | `/path/to/your/project/` |

**Important:** The `.task/` directory is created in your **project directory**, not the plugin directory.

## Architecture Overview

```
Multi-Session Orchestrator Pipeline (Task-Based Enforcement)
  |
  +-- Orchestrator (Main Session)
  |     +-- Creates pipeline task chain with blockedBy dependencies
  |     +-- Executes data-driven main loop (TaskList → Execute → Complete)
  |     +-- Handles decision escalation from workers
  |     +-- Creates dynamic fix tasks on review failures
  |
  +-- Phase 1: Requirements (INTERACTIVE)
  |     +-- Task: "Gather requirements"
  |     +-- requirements-gatherer agent (opus)
  |     +-- Resume for user Q&A iterations
  |     -> .task/user-story.json
  |
  +-- Phase 2: Planning (SEMI-INTERACTIVE)
  |     +-- Task: "Create implementation plan"
  |     +-- planner agent (opus)
  |     +-- Resume if reviews request changes
  |     -> .task/plan-refined.json
  |
  +-- Phase 3: Plan Reviews (TASK-ENFORCED SEQUENTIAL)
  |     +-- Task: "Plan Review - Sonnet" (blockedBy: plan)
  |     +-- Task: "Plan Review - Opus" (blockedBy: sonnet)
  |     +-- Task: "Plan Review - Codex" (blockedBy: opus) <- FINAL GATE
  |     -> .task/review-*.json
  |
  +-- Phase 4: Implementation
  |     +-- Task: "Implementation" (blockedBy: codex-plan-review)
  |     +-- implementer agent (sonnet)
  |     +-- Resume for iterative fixes
  |     -> .task/impl-result.json
  |
  +-- Phase 5: Code Reviews (TASK-ENFORCED SEQUENTIAL)
  |     +-- Task: "Code Review - Sonnet" (blockedBy: implementation)
  |     +-- Task: "Code Review - Opus" (blockedBy: sonnet)
  |     +-- Task: "Code Review - Codex" (blockedBy: opus) <- FINAL GATE
  |     -> .task/review-*.json
  |
  +-- Phase 6: Completion
        +-- Report results
```

---

## Task-Based Pipeline Enforcement

### Why Task-Based?

The pipeline uses Claude Code's TaskCreate/TaskUpdate/TaskList tools to create **structural enforcement** via explicit task dependencies, rather than relying on instruction-following.

| Instruction-Based (Old) | Task-Based (New) |
|-------------------------|------------------|
| "Run Sonnet → Opus → Codex" | `blockedBy` prevents Codex until Opus completes |
| LLM can skip "redundant" steps | LLM queries TaskList() for next available task |
| No audit trail | Complete task history with metadata |
| Hidden progress | User sees real-time task progress |

**Key Insight:** `blockedBy` is **data**, not an instruction. When the orchestrator calls `TaskList()`, blocked tasks cannot be claimed. The prompt becomes "find next unblocked task" - a data query, not instruction following.

### Pipeline Task Chain

At pipeline start, these tasks are created with dependencies:

```
T1: Gather requirements          (blockedBy: [])
T2: Create implementation plan   (blockedBy: [T1])
T3: Plan Review - Sonnet         (blockedBy: [T2])
T4: Plan Review - Opus           (blockedBy: [T3])
T5: Plan Review - Codex          (blockedBy: [T4])   <- GATE
T6: Implementation               (blockedBy: [T5])
T7: Code Review - Sonnet         (blockedBy: [T6])
T8: Code Review - Opus           (blockedBy: [T7])
T9: Code Review - Codex          (blockedBy: [T8])   <- GATE
```

### Dynamic Fix Tasks

When a review returns `needs_changes`, the orchestrator:

1. Creates a fix task: `"Fix [Phase] Issues - Iteration N"`
2. Creates a RE-REVIEW task for the SAME reviewer (blocked by fix task)
3. Updates the NEXT reviewer's `blockedBy` to include the re-review task (not the fix task)
4. Marks the current review as completed with `metadata: {result: "needs_changes"}`
5. After max 3 re-reviews per reviewer, escalates to user

This maintains the sequential requirement and ensures the same reviewer validates fixes before proceeding.

---

## Quick Start

```
/multi-ai [description of what you want]
```

The pipeline will:
1. **Create task chain** with dependencies
2. **Gather requirements** (interactive) - Custom agent with Business Analyst + PM expertise
3. **Plan** (semi-interactive) - Custom agent with Architect expertise
4. **Review plan** (task-enforced) - Sequential: Sonnet → Opus → Codex gate
5. **Implement** - Iterates until reviews approve
6. **Review code** (task-enforced) - Sequential: Sonnet → Opus → Codex gate
7. **Complete** - Report results

---

## Custom Agents

The pipeline uses specialized agents defined in `agents/` directory. Model selection is controlled by the orchestrator via Task tool, not hardcoded in agent definitions.

| Agent | Recommended Model | Purpose |
|-------|-------------------|---------|
| **requirements-gatherer** | opus | Business Analyst + Product Manager hybrid |
| **planner** | opus | Architect + Fullstack Developer hybrid |
| **plan-reviewer** | sonnet/opus | Architect + Security + QA hybrid |
| **implementer** | sonnet | Fullstack + TDD + Quality hybrid |
| **code-reviewer** | sonnet/opus | Security + Performance + QA hybrid |

See `AGENTS.md` for detailed agent specifications.

---

## Key Features

### Task + Resume Architecture

Workers can be resumed with preserved context:
- **Resume for context** - Maintains conversation history across iterations
- **Fresh analysis** - Reviews start fresh for unbiased perspective

### Task-Based Sequential Enforcement

Reviews are enforced via `blockedBy` dependencies:
- Codex review **cannot start** until Opus review completes
- Opus review **cannot start** until Sonnet review completes
- This is data-driven, not instruction-driven

### Codex as Final Gate

Codex (independent AI) provides final approval:
- Different AI family catches different issues
- Not "Claude reviewing Claude"
- Required before implementation can start

---

## Skills

| Skill | Purpose | Phase |
|-------|---------|-------|
| `/multi-ai` | Start pipeline (entry point) | All |

**Note:** Requirements gathering, planning, review (sonnet/opus), and implementation are handled by custom agents via Task tool. Codex final gate review uses the `codex-reviewer` agent via `Task(subagent_type: "claude-codex:codex-reviewer", model: "external")`.

---

## Hook Enforcement

Pipeline enforcement uses two hooks:

### UserPromptSubmit Hook (Guidance)
- **File:** `hooks/guidance-hook.js`
- **Purpose:** Reads `.task/*.json` files to determine phase, injects advisory guidance
- **No state tracking:** Phase is implicit from which artifact files exist

### SubagentStop Hook (Enforcement)
- **File:** `hooks/review-validator.js`
- **Purpose:** Validates reviewer outputs when agents finish
- **Can block:** Returns `{"decision": "block", "reason": "..."}` if:
  - Review doesn't verify all acceptance criteria
  - Review approves with unimplemented ACs
  - `needs_changes` without fix/re-review tasks created

Max 10 re-reviews per reviewer before escalating to user.

---

## Output Formats

### User Story (`.task/user-story.json`)
```json
{
  "id": "story-YYYYMMDD-HHMMSS",
  "title": "Feature title",
  "requirements": {...},
  "acceptance_criteria": [...],
  "scope": {...},
  "test_criteria": {...},
  "implementation": { "max_iterations": 10 }
}
```

### Plan Refined (`.task/plan-refined.json`)
```json
{
  "id": "plan-YYYYMMDD-HHMMSS",
  "title": "Plan title",
  "technical_approach": {...},
  "steps": [...],
  "test_plan": {...},
  "risk_assessment": {...},
  "completion_promise": "<promise>IMPLEMENTATION_COMPLETE</promise>"
}
```

### Pipeline Tasks (`.task/pipeline-tasks.json`)
```json
{
  "requirements": "task-id-1",
  "plan": "task-id-2",
  "plan_review_sonnet": "task-id-3",
  "plan_review_opus": "task-id-4",
  "plan_review_codex": "task-id-5",
  "implementation": "task-id-6",
  "code_review_sonnet": "task-id-7",
  "code_review_opus": "task-id-8",
  "code_review_codex": "task-id-9"
}
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `orchestrator.sh` | Initialize/reset pipeline, show status |
| `json-tool.ts` | Cross-platform JSON operations |
| `codex-detect.js` | Codex detect sprint — exec mode (G6) with hint/coverage support |
| `codex-deep-exploit.js` | Codex deep exploit hunt — exec mode (G6) |
| `generate-bundle-detect-codex.js` | Bundle generator for Codex detect |
| `codex-exploit-verify.js` | Codex exploit proof gate — exec mode (G6), `--live-chain` support (G4) |
| `codex-patch-verify.js` | Codex patch verification — exec mode (G6) |
| `run-detect-pipeline.js` | Detect pipeline orchestrator (G2) |
| `generate-hints.js` | Cross-model medium hints (location + mechanism) |
| `merge-detect-findings.js` | Dual-model finding merge + dedup |
| `coverage-tracker.js` | Entrypoint/module coverage tracking |
| `judge-findings.js` | Cross-model finding validation (G5) |
| `match-findings.js` | Benchmark matching: detected vs ground truth (G8) |
| `run-benchmark.js` | Benchmark runner: iterate benchmarks, run pipeline, score (G8) |
| `score-benchmark.js` | Compare benchmark results across runs (G8) |
| `setup-benchmarks.js` | Clone benchmark repos from registry (G8) |
| `rpc-gatekeeper.js` | Whitelist-based JSON-RPC proxy for Anvil (G4) |
| `run-exploit-env.js` | Anvil startup + wallet seeding + deploy-artifacts.json (G4) |
| `grade-exploit.js` | Pre/post balance comparison + per-vuln grading scripts (G4, G23) |
| `replay-transactions.js` | Transaction replay against fresh chain for grading (G24) |
| `generate-slither-summary.js` | Convert slither.json + semgrep.json → slither-summary.md for detect bundles |

---

## Emergency Controls

If stuck:

1. **Check task state:** `TaskList()` to see blocked tasks
2. **Check artifacts:** Read `.task/*.json` files to understand progress
3. **Reset pipeline:** `"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset`

---

## Model Assignment Summary

| Phase | Agent | Model | Reason |
|-------|-------|-------|--------|
| Requirements | requirements-gatherer | **opus** | Deep understanding + user interaction |
| Planning | planner | **opus** | Comprehensive codebase research |
| Plan Review #1 | plan-reviewer | sonnet | Quick quality check |
| Plan Review #2 | plan-reviewer | opus | Deep architectural analysis |
| Plan Review #3 | **Codex** | external | Independent final gate |
| Implementation | implementer | sonnet | Balanced speed/quality |
| Code Review #1 | code-reviewer | sonnet | Quick code check |
| Code Review #2 | code-reviewer | opus | Deep code analysis |
| Code Review #3 | **Codex** | external | Independent final gate |
