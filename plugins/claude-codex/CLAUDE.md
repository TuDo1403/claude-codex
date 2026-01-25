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
  +-- Phase 4: Implementation (RALPH LOOP)
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
2. Updates the next reviewer's `blockedBy` to include the fix task
3. Marks the current review as completed with `metadata: {result: "needs_changes"}`

This maintains the sequential requirement: fixes must complete before the next reviewer runs.

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
5. **Implement** (ralph loop) - Iterates until tests pass + reviews approve
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
- **Signal protocol** - Workers communicate needs via `.task/worker-signal.json`

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

### Worker Signal Protocol

Workers communicate via `.task/worker-signal.json`:

```json
{
  "worker_id": "phase-timestamp-random",
  "phase": "requirements|planning|implementation",
  "status": "needs_input|completed|error|in_progress",
  "questions": [...],
  "agent_id": "for_resume"
}
```

---

## Skills

| Skill | Purpose | Phase |
|-------|---------|-------|
| `/multi-ai` | Start pipeline (entry point) | All |
| `/cancel-loop` | Cancel active ralph loop | Emergency |

**Note:** Requirements gathering, planning, review (sonnet/opus), and implementation are handled by custom agents via Task tool. Codex final gate review uses the `codex-reviewer` agent via `Task(subagent_type: "claude-codex:codex-reviewer", model: "external")`.

---

## Implementation Modes

### Simple Mode
For small, straightforward changes:
- Single implementation pass
- One review cycle
- Tests run once

### Ralph Loop Mode (Default)
For features requiring iteration:
- Implementer agent resumed for fixes
- Reviews + tests run each iteration
- Loops until ALL pass:
  - Sonnet review: approved
  - Opus review: approved
  - Codex review: approved
  - All test commands: exit code 0

---

## State Machine

```
idle
  |
requirements_gathering (requirements-gatherer agent)
  | [approved]
plan_drafting
  |
plan_refining (planner agent)
  | [conflicts? -> ask user]
plan_reviewing (task-enforced: sonnet -> opus -> codex)
  | [all approved]
implementing (simple) OR implementing_loop (ralph)
  |
  | [ralph loop mode]
  |  +-- implement -> review -> test
  |  |   IF all pass -> exit
  |  |   ELSE -> resume implementer, loop
  |
complete
```

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
  "implementation": { "mode": "ralph-loop", "max_iterations": 10 }
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

### Loop State (`.task/loop-state.json`)
```json
{
  "active": true,
  "iteration": 0,
  "max_iterations": 10,
  "implementer_agent_id": "for-resume",
  "started_at": "ISO8601"
}
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `state-manager.sh` | Manage pipeline state |
| `orchestrator.sh` | Initialize/reset pipeline |
| `json-tool.ts` | Cross-platform JSON operations |
| `worker-protocol.ts` | Worker signal management |

---

## Emergency Controls

If the loop is stuck:

1. **Cancel command:** `/cancel-loop`
2. **Check task state:** `TaskList()` to see blocked tasks
3. **Delete state file:** `rm .task/loop-state.json`
4. **Max iterations:** Loop auto-stops at limit

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
