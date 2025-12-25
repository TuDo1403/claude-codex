# Pipeline Workflow

## Architecture Overview

This pipeline uses a **subagent-based architecture**:

- **Main Claude Code thread** = Orchestrator only (coordinates work)
- **Subagents** = Do the actual work (planning, coding, reviewing)
- **Codex** = Final review checkpoints only (end of planning, end of implementation)

### Subagents

Located in `.claude/agents/`:

| Subagent | Purpose | Model |
|----------|---------|-------|
| `planner` | Drafts and refines plans | opus |
| `implementer` | Writes code | opus |
| `researcher` | Codebase exploration | opus |
| `reviewer-sonnet` | Fast review (code + security + tests) | sonnet |
| `reviewer-opus` | Deep review (code + security + tests) | opus |

> **Dual Review Model**: Internal reviewers run in parallel with both sonnet and opus to get different perspectives. Both must approve before proceeding.

---

## Starting a New Task

1. Create `.task/user-request.txt` with your request
2. Set state: `./scripts/state-manager.sh set plan_drafting ""`
3. Run: `./scripts/orchestrator.sh`

---

## Workflow Phases

### Phase 1: Planning

```
plan_drafting
     ↓ (planner subagent creates initial plan)
plan_refining
     ↓ (planner + researcher subagents refine)
     ↓ (reviewer-sonnet + reviewer-opus internal review)
     ↓ [loop until internally approved]
plan_reviewing
     ↓ (Codex final review)
     ↓ [approved] → implementing
     ↓ [needs_changes] → back to plan_refining
```

**Subagent Flow:**
1. `planner` → Creates initial plan from user request
2. `researcher` → Gathers codebase context
3. `planner` → Refines plan with technical details
4. `reviewer-sonnet` + `reviewer-opus` → Internal review (loops until solid)
5. **Codex** → Final plan review (only Codex call in planning phase)

### Phase 2: Implementation

```
implementing
     ↓ (implementer subagent writes code)
     ↓ (reviewer-sonnet + reviewer-opus internal reviews)
     ↓ [loop until internally approved]
reviewing
     ↓ (Codex final review)
     ↓ [approved] → complete
     ↓ [needs_changes] → fixing → reviewing
```

**Subagent Flow:**
1. `implementer` → Writes code following standards
2. `reviewer-sonnet` + `reviewer-opus` → Internal review (code + security + tests)
3. **Codex** → Final code review (only Codex call in implementation phase)

---

## Using the Orchestrator

The orchestrator shows the current state and what action to take next:

```bash
./scripts/orchestrator.sh
```

Example output:
```
[INFO] Current state: plan_drafting

ACTION: Invoke 'planner' subagent

Task: Create initial plan from user request
Input: .task/user-request.txt
Output: .task/plan.json

After completion, transition state:
  ./scripts/state-manager.sh set plan_refining "$(jq -r .id .task/plan.json)"
```

### Commands

| Command | Purpose |
|---------|---------|
| `./scripts/orchestrator.sh` | Show current state and next action |
| `./scripts/orchestrator.sh status` | Show current state details |
| `./scripts/orchestrator.sh reset` | Reset pipeline to idle |
| `./scripts/orchestrator.sh dry-run` | Validate setup |

---

## State Machine

### States

| State | Description |
|-------|-------------|
| `idle` | No active task |
| `plan_drafting` | Creating initial plan |
| `plan_refining` | Refining plan with technical details |
| `plan_reviewing` | Codex final plan review |
| `implementing` | Writing code |
| `reviewing` | Codex final code review |
| `fixing` | Fixing issues from code review |
| `complete` | Task finished |
| `error` | Pipeline error |
| `needs_user_input` | Waiting for user clarification |

### Full Flow

```
idle
  ↓
plan_drafting (planner subagent)
  ↓
plan_refining (planner + researcher + reviewer internal loop)
  ↓
plan_reviewing (Codex final review) ←──────────────────┐
  ↓                                                    │
  [needs_changes] → back to plan_refining ─────────────┘
  ↓ [approved]
implementing (implementer + internal reviewers loop)
  ↓
reviewing (Codex final review) ←───────────────────────┐
  ↓                                                    │
  [needs_changes] → fixing → back to reviewing ────────┘
  ↓ [approved]
complete
```

### State Transitions

| From | To | Trigger |
|------|----|---------|
| `idle` | `plan_drafting` | User sets state with user-request.txt |
| `plan_drafting` | `plan_refining` | Planner creates initial plan |
| `plan_refining` | `plan_reviewing` | Both reviewers approve (sonnet + opus) |
| `plan_reviewing` | `plan_refining` | Codex requests changes |
| `plan_reviewing` | `implementing` | Codex approves → Claude Code runs plan-to-task.sh |
| `implementing` | `reviewing` | Both internal reviewers approve (sonnet + opus) |
| `reviewing` | `complete` | Codex approves |
| `reviewing` | `fixing` | Codex requests changes |
| `reviewing` | `error` | Codex rejects (fundamentally flawed) |
| `fixing` | `reviewing` | Implementer fixes issues |
| `*` | `error` | Failure after retries |
| `*` | `needs_user_input` | Subagent needs clarification |

> **Note**: `rejected` status means the task is fundamentally flawed and cannot be fixed with minor changes. Use `./scripts/recover.sh` to restart with a new approach.

---

## Output Formats

### plan.json (Initial plan)
```json
{
  "id": "plan-YYYYMMDD-HHMMSS",
  "title": "Short descriptive title",
  "description": "What the user wants to achieve",
  "requirements": ["req1", "req2"],
  "created_at": "ISO8601",
  "created_by": "planner"
}
```

### plan-refined.json (Refined plan)
```json
{
  "id": "plan-001",
  "title": "Feature title",
  "description": "What the user wants",
  "requirements": ["req 1", "req 2"],
  "technical_approach": "How to implement",
  "files_to_modify": ["path/to/file.ts"],
  "files_to_create": ["path/to/new.ts"],
  "dependencies": [],
  "estimated_complexity": "low|medium|high",
  "potential_challenges": ["challenge 1"],
  "refined_by": "planner",
  "refined_at": "ISO8601"
}
```

### Internal review outputs (dual-model)

Each reviewer covers code quality, security, and test coverage:

| File | Reviewer |
|------|----------|
| `.task/internal-review-sonnet.json` | reviewer-sonnet |
| `.task/internal-review-opus.json` | reviewer-opus |

> **Both phases**: 2 reviewers must approve (sonnet + opus) before proceeding to Codex final review.

Format:
```json
{
  "status": "approved|needs_changes",
  "reviewer": "reviewer-sonnet",
  "model": "sonnet",
  "reviewed_at": "ISO8601",
  "summary": "Review summary",
  "code_issues": [...],
  "security_issues": [...],
  "test_issues": [...]
}
```

### plan-review.json (Codex final plan review)
```json
{
  "status": "approved|needs_changes",
  "summary": "Overall assessment",
  "concerns": [
    {
      "severity": "error|warning|suggestion",
      "area": "requirements|approach|complexity|risks|feasibility",
      "message": "Description of concern",
      "suggestion": "How to address"
    }
  ],
  "reviewed_by": "codex",
  "reviewed_at": "ISO8601"
}
```

### impl-result.json (Implementation result)
```json
{
  "status": "completed|failed|needs_clarification",
  "summary": "What was implemented",
  "files_changed": ["path/to/file.ts"],
  "tests_added": ["path/to/test.ts"],
  "questions": []
}
```

### review-result.json (Codex final code review)
Schema enforced via --output-schema.
See docs/schemas/review-result.schema.json

---

## Orchestrator Safety Features

### Atomic Locking

The orchestrator uses PID-based locking for destructive operations:

- Lock file: `.task/.orchestrator.lock`
- Only used by `reset` command (not `run` or `status`)
- Stale locks (dead PID) are automatically cleaned up

```bash
# If you see "Another orchestrator is running" but it's stale:
rm .task/.orchestrator.lock
```

### Dry-Run Validation

Validate setup before running:

```bash
./scripts/validate-config.sh  # Strict config validation
./scripts/orchestrator.sh dry-run
```

Checks:
- `.task/` directory exists
- `state.json` valid (or will be created)
- `pipeline.config.json` valid
- Required scripts executable
- Required subagents exist
- Required docs exist
- `.task` in `.gitignore`
- CLI tools available

### Phase-Aware Recovery

The recovery tool respects which phase failed:

- Errors in `plan_drafting` → retry from `plan_drafting`
- Errors in `plan_refining`/`plan_reviewing` → retry from `plan_refining`
- Errors in `implementing`/`reviewing`/`fixing` → retry from `implementing`

```bash
# Interactive recovery
./scripts/recover.sh

# Check previous state
cat .task/state.json | jq '.previous_state'
```

### Local Config Overrides

Create `pipeline.config.local.json` for local overrides (gitignored):

```json
{
  "autonomy": {
    "planReviewLoopLimit": 15,
    "codeReviewLoopLimit": 20
  }
}
```

---

## Current Sprint Context

Add sprint-specific context here as needed. This section is referenced by the orchestrator when starting new features.
