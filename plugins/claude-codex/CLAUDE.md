# Claude Code - Multi-AI Pipeline Project

> **IMPORTANT**: This project uses a skill-based sequential review workflow. The main Claude Code thread handles planning and implementation. Reviews use forked skills (sonnet → opus → codex) that run in isolated contexts.

## Path Reference

When this plugin is installed, paths are resolved as follows:

| Variable | Purpose | Example |
|----------|---------|---------|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin installation directory (scripts, docs, configs) | `~/.claude/plugins/claude-codex/` |
| `${CLAUDE_PROJECT_DIR}` | Your project directory (task state files) | `/path/to/your/project/` |

**Important:** The `.task/` directory is always created in your **project directory**, not the plugin directory. This allows the plugin to work across multiple projects without conflicts.

## Architecture Overview

```
Main Claude Code Thread (Does the Work)
  │
  ├── Planning & Research (main thread)
  │     ├── Creates initial plan from user request
  │     └── Refines plan with technical details
  │
  ├── Implementation Skill:
  │     └── /implement-sonnet → Writes code (sonnet model, main context)
  │
  └── Review Skills (sequential, forked context):
        ├── /review-sonnet → Fast review (sonnet model)
        ├── /review-opus   → Deep review (opus model)
        └── /review-codex  → Final review (codex)
```

---

## When User Asks to Implement Something

Guide users to use the orchestrator workflow:

```
This project uses a skill-based review workflow.

To implement your request:

1. Create your request:
   echo "Your feature description here" > .task/user-request.txt

2. Start the pipeline:
   "${CLAUDE_PLUGIN_ROOT}/scripts/state-manager.sh" set plan_drafting ""
   "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh"

The pipeline will:
- Create and refine a plan (main thread)
- Sequential reviews: /review-sonnet → /review-opus → /review-codex
- Implement the code (/implement-sonnet)
- Sequential reviews: /review-sonnet → /review-opus → /review-codex

For status: "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" status
For recovery: "${CLAUDE_PLUGIN_ROOT}/scripts/recover.sh"
```

---

## Skills

Located in `skills/` (plugin root level for `/plugin install` support):

| Skill | Purpose | Model |
|-------|---------|-------|
| `/implement-sonnet` | Code implementation (main context) | sonnet |
| `/review-sonnet` | Fast review (forked context) | sonnet |
| `/review-opus` | Deep review (forked context) | opus |
| `/review-codex` | Final review via Codex CLI | codex |

### Sequential Review Flow

Reviews run **sequentially** - each model reviews only ONCE per cycle:

```
sonnet → fix (if needed) → opus → fix (if needed) → codex → fix (restart from sonnet if needed)
```

**Key benefits**:
- Each model provides unique perspective without re-reviewing
- Progressive refinement (fast → deep → final)
- Token-efficient (forked context isolation)

### Invoking Review Skills

Simply invoke the skill by name:

```
/review-sonnet
/review-opus
/review-codex
```

Skills auto-detect whether to review plan or code based on:
- Plan review: `.task/plan-refined.json` exists, no `.task/impl-result.json`
- Code review: `.task/impl-result.json` exists

### Review Outputs

| File | Skill |
|------|-------|
| `.task/review-sonnet.json` | /review-sonnet |
| `.task/review-opus.json` | /review-opus |
| `.task/review-codex.json` | /review-codex |

---

## State Machine (Simplified)

```
idle
  ↓
plan_drafting (main thread creates plan)
  ↓
plan_refining (main thread refines + sequential skill reviews)
  │
  │  Review cycle: sonnet → opus → codex
  │  If codex needs_changes: restart from sonnet
  │
  ↓ [all approved]
implementing (/implement-sonnet + sequential skill reviews)
  │
  │  Review cycle: sonnet → opus → codex
  │  If codex needs_changes: restart from sonnet
  │
  ↓ [all approved]
complete
```

---

## Shared Knowledge

Read these docs before any work:
- `${CLAUDE_PLUGIN_ROOT}/docs/standards.md` - Coding standards and review criteria
- `${CLAUDE_PLUGIN_ROOT}/docs/workflow.md` - Pipeline process and output formats

---

## Output Formats

### Plan Creation Output
Write to: `.task/plan.json`

```json
{
  "id": "plan-YYYYMMDD-HHMMSS",
  "title": "Short descriptive title",
  "description": "What the user wants to achieve",
  "requirements": ["req1", "req2"],
  "created_at": "ISO8601",
  "created_by": "claude"
}
```

### Plan Refinement Output
Write to: `.task/plan-refined.json`

```json
{
  "id": "plan-001",
  "title": "Feature title",
  "description": "What the user wants",
  "requirements": ["req 1", "req 2"],
  "technical_approach": "Detailed description of how to implement",
  "files_to_modify": ["path/to/existing/file.ts"],
  "files_to_create": ["path/to/new/file.ts"],
  "dependencies": ["any new packages needed"],
  "estimated_complexity": "low|medium|high",
  "potential_challenges": [
    "Challenge 1 and how to address it",
    "Challenge 2 and how to address it"
  ],
  "refined_by": "claude",
  "refined_at": "ISO8601"
}
```

### Implementation Output
Write to: `.task/impl-result.json`

```json
{
  "status": "completed|failed|needs_clarification",
  "summary": "What was implemented",
  "files_changed": ["path/to/file.ts"],
  "tests_added": ["path/to/test.ts"],
  "questions": []
}
```

---

## Review Handling

### Sequential Review Process

For both planning and implementation phases:

1. **Invoke /review-sonnet**
   - If `needs_changes`: fix issues, continue to step 2
   - If `approved`: continue to step 2

2. **Invoke /review-opus**
   - If `needs_changes`: fix issues, continue to step 3
   - If `approved`: continue to step 3

3. **Invoke /review-codex**
   - If `needs_changes`: fix issues, **restart from step 1**
   - If `approved`: proceed to next phase

### Why Sequential?

- Skills run in forked context (token-efficient)
- Each model reviews ONCE per cycle (no redundant re-reviews)
- Progressive refinement catches issues at appropriate depth

---

## Strict Loop-Until-Pass Model

- Reviews loop until all three approve
- No debate mechanism - accept all review feedback
- Fix ALL issues raised by any reviewer
- Codex rejection restarts the full review cycle

---

## Asking for Clarification

If a plan or task is too ambiguous, add to your output:

```json
{
  "needs_clarification": true,
  "questions": [
    "Question 1 for the user?",
    "Question 2 for the user?"
  ]
}
```

The orchestrator will transition to `needs_user_input` state.
