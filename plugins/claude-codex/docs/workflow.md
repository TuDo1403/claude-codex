# Pipeline Workflow (Task + Hook Architecture)

## Architecture Overview

This pipeline uses a **Task + Hook architecture**:

- **Tasks (Primary)** - Structural enforcement via `blockedBy` dependencies
- **Hook (Guidance)** - Validates output, transitions state, injects reminders
- **Main Thread** - Orchestrator that handles user input and creates dynamic tasks
- **Codex** - Final review gate via `codex-reviewer` agent

### Custom Agents

| Agent | Model | Purpose | Phase |
|-------|-------|---------|-------|
| `requirements-gatherer` | opus | Business Analyst + PM hybrid | Requirements |
| `planner` | opus | Architect + Fullstack hybrid | Planning |
| `plan-reviewer` | sonnet/opus | Architecture + Security + QA | Plan Review |
| `implementer` | sonnet | Fullstack + TDD + Quality | Implementation |
| `code-reviewer` | sonnet/opus | Security + Performance + QA | Code Review |
| `codex-reviewer` | external | Final gate (invokes Codex CLI) | Final Review |

---

## Quick Start

```
/multi-ai Add user authentication with JWT tokens
```

This command handles the entire workflow:

1. **Requirements gathering** (interactive) - requirements-gatherer agent
2. **Planning** (semi-interactive) - planner agent
3. **Plan reviews** (sequential) - plan-reviewer agents + Codex gate
4. **Implementation** - implementer agent
5. **Code reviews** (sequential) - code-reviewer agents + Codex gate
6. **Completion** - Report results

---

## State Flow

```
idle → requirements_gathering → plan_drafting
  → plan_review_sonnet ↔ fix_plan_sonnet
  → plan_review_opus ↔ fix_plan_opus
  → plan_review_codex ↔ fix_plan_codex
  → implementation
  → code_review_sonnet ↔ fix_code_sonnet
  → code_review_opus ↔ fix_code_opus
  → code_review_codex ↔ fix_code_codex
  → complete
```

Max 10 re-reviews per reviewer before escalating to user.

---

## Task Chain

At pipeline start, create tasks with dependencies:

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

When a review returns `needs_changes`:

1. Create fix task (blockedBy: current review)
2. Create re-review task for SAME reviewer (blockedBy: fix)
3. Update NEXT reviewer's blockedBy to include re-review

---

## Output Files

| File | Description |
|------|-------------|
| `.task/user-story.json` | Approved requirements |
| `.task/plan-refined.json` | Implementation plan |
| `.task/review-sonnet.json` | Sonnet plan review |
| `.task/review-opus.json` | Opus plan review |
| `.task/review-codex.json` | Codex plan review |
| `.task/impl-result.json` | Implementation result |
| `.task/code-review-sonnet.json` | Sonnet code review |
| `.task/code-review-opus.json` | Opus code review |
| `.task/code-review-codex.json` | Codex code review |
| `.task/state.json` | Pipeline state |
| `.task/pipeline-tasks.json` | Task ID mapping |

---

## Review Statuses

**Plan reviews:**
- `approved` - Proceed to next reviewer
- `needs_changes` - Fix and re-review (same reviewer)
- `needs_clarification` - Ask user

**Code reviews:**
- `approved` - Proceed to next reviewer
- `needs_changes` - Fix and re-review (same reviewer)
- `rejected` - Major rework required

**Codex plan `rejected`** is terminal - escalate to user.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `orchestrator.sh` | Show current state and next action |
| `orchestrator.sh status` | Show current state details |
| `orchestrator.sh reset` | Reset pipeline to idle |
| `orchestrator.sh dry-run` | Validate setup |
| `state-manager.sh set <phase> ""` | Manual state transition |

---

## Emergency Controls

If stuck:

1. **Check task state:** `TaskList()` to see blocked tasks
2. **Check state file:** Read `.task/state.json`
3. **Reset pipeline:** `"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset`
4. **Manual state:** `"${CLAUDE_PLUGIN_ROOT}/scripts/state-manager.sh" set <phase> ""`

---

## Default Settings

| Setting | Value |
|---------|-------|
| Max iterations per reviewer | 10 |
| Plan review limit | 10 |
| Code review limit | 15 |
