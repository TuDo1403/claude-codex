---
name: blind-audit-sc
description: Blind-audit pipeline for fund-sensitive smart contracts. Enforces strict separation - spec reviewers cannot see code, exploit hunters cannot see spec narrative. Red-team loop until all HIGH/MED issues CLOSED.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Blind-Audit Smart Contract Pipeline

You coordinate a **6-stage blind-audit pipeline** for fund-sensitive smart contracts with **strict blindness enforcement** between reviewers.

**Key Blindness Rules:**
- **Stage 0 (Requirements)** Codex gathers requirements with acceptance criteria
- **Stage 3 (Spec Compliance)** reviews specs WITHOUT seeing code
- **Stage 4 (Exploit Hunt)** reviews code WITHOUT seeing spec narrative
- **Stage 5 (Red-Team Loop)** iterates until all HIGH/MED issues CLOSED

**Task directory:** `${CLAUDE_PROJECT_DIR}/.task/`
**Run bundles:** `${CLAUDE_PROJECT_DIR}/.task/<run_id>/`
**Reports directory:** `${CLAUDE_PROJECT_DIR}/reports/`
**Docs directory:** `${CLAUDE_PROJECT_DIR}/docs/`
**Agents location:** `${CLAUDE_PLUGIN_ROOT}/agents/`
**Templates location:** `${CLAUDE_PLUGIN_ROOT}/templates/`
**Scripts location:** `${CLAUDE_PLUGIN_ROOT}/scripts/`

---

## Non-Negotiable Principles

1. **Blindness is mandatory** - Stage 3 sees NO code; Stage 4 sees NO spec prose
2. **Evidence-based gates** - Every stage produces verifiable artifacts
3. **Red-team closure required** - All HIGH/MED issues CLOSED with regression tests before final gate
4. **Codex leads and closes** - Codex writes specs, Codex gives final approval
5. **Bundle validation** - Hooks block if blindness constraints violated

---

## Pipeline Architecture

```
STAGE 0: Codex Requirements Gathering
    | user-story.json (acceptance criteria, scope)
    v
STAGE 1: Codex Spec Writing (Strategist)
    | threat-model.md, design.md, test-plan.md
    v
STAGE 2: Spec Gate Validation
    | validates completeness, invariants, AC measurable
    v
STAGE 3: Claude Implementation (TDD)
    | Source code + tests + reports
    v
+---+-------------------+
|   |                   |
v   v                   |
BUNDLE-STAGE3         BUNDLE-STAGE4
(NO code)             (NO spec prose)
    |                   |
    v                   v
STAGE 3: Spec Compliance Review     STAGE 4: Exploit Hunt Review
(blind to code)                     (blind to spec narrative)
    |                               |
    v                               v
    +---------------+---------------+
                    |
                    v
              STAGE 5: Red-Team Loop
              (iterates until all HIGH/MED CLOSED)
                    |
                    v
              BUNDLE-FINAL
              (complete bundle)
                    |
                    v
              STAGE 6: Codex Final Gate
              (APPROVED required)
```

---

## Task Graph with Dependencies

```
T0: codex_requirements         (blockedBy: [])
T1: codex_spec_write           (blockedBy: [T0])
T2: spec_gate_validate         (blockedBy: [T1])
T3: claude_implement           (blockedBy: [T2])
T4: run_tests_collect_reports  (blockedBy: [T3])
T5: bundle_generate_stage3     (blockedBy: [T2])
T6: bundle_generate_stage4     (blockedBy: [T4])
T7: spec_compliance_review     (blockedBy: [T4, T5])
    -> Loop if NEEDS_CHANGES: codex_spec_fix -> re-validate -> re-review
T8: exploit_hunt_review        (blockedBy: [T6, T7])
    -> Loop if HIGH/MED issues: red_team_patch_game until all CLOSED
T9: bundle_generate_final      (blockedBy: [T8])
T10: codex_final_gate          (blockedBy: [T9])
```

---

## Blindness Rules (STRICT)

### Stage 3 Bundle (Spec Compliance) - NO CODE

**Script:** `scripts/generate-bundle-stage3.js`

**Includes:**
- `docs/security/threat-model.md` (full)
- `docs/architecture/design.md` (full)
- `docs/testing/test-plan.md` (full)
- `test-summary.md` (test names + PASS/FAIL only)
- `gas-summary.md` (function names + gas only)

**Excludes:**
- `src/**/*.sol` - NO source code
- `test/**/*.sol` - NO test code
- `git diff` - NO implementation details
- Any file containing Solidity code

**Output:** `.task/<run_id>/bundle-stage3/`

### Stage 4 Bundle (Exploit Hunt) - NO SPEC NARRATIVE

**Script:** `scripts/generate-bundle-stage4.js`

**Includes:**
- `invariants-list.md` (ONLY numbered I1..In with formal expressions)
- `public-api.md` (interfaces only, extracted from code)
- Full source code (`src/**/*.sol`)
- Full test code (`test/**/*.sol`)
- `slither-summary.md` (if available)

**Excludes:**
- `docs/security/threat-model.md` prose (attack surface descriptions, trust assumptions)
- `docs/architecture/design.md` narrative
- `docs/testing/test-plan.md` (except invariants-list.md extraction)
- Any document describing "why" or "motivation"

**Output:** `.task/<run_id>/bundle-stage4/`

### Final Bundle (Codex Gate) - COMPLETE

**Script:** `scripts/generate-bundle-final.js`

**Includes:**
- Everything from Stage 3 and Stage 4
- All review outputs
- Red-team issue log
- All evidence files

**Output:** `.task/<run_id>/bundle-final/`

---

## Gate Validations

| Gate | Name | Validates | Hook |
|------|------|-----------|------|
| A | Spec Completeness | Invariants numbered I1-In, test mapping exists, AC measurable | `blind-audit-gate-validator.js` |
| B | Evidence Presence | test-summary.md, gas-summary.md exist, forge tests pass | `blind-audit-gate-validator.js` |
| C | Bundle Correctness | Stage 3 has NO code; Stage 4 has NO spec prose | `bundle-validator.js` |
| D | Review Schema | Review outputs conform to strict schemas | `blind-audit-gate-validator.js` |
| E | Red-Team Closure | All HIGH/MED CLOSED with regression test references | `redteam-closure-validator.js` |
| F | Final Gate | All gates green, Codex outputs APPROVED | `blind-audit-gate-validator.js` |

---

## Configuration

Read `.claude-codex.json` from project root (or use defaults):

```json
{
  "blind_audit_sc": {
    "enable_invariants": true,
    "min_fuzz_runs": 5000,
    "require_slither": true,
    "require_semgrep": false,
    "fail_on_static_high": true,
    "fail_on_static_medium": true,
    "bundle_mode": "diff",
    "blind_enforcement": "strict",
    "max_redteam_iterations": 10,
    "require_regression_tests": true
  }
}
```

---

## Pipeline Initialization

### Step 1: Load Configuration

```javascript
const config = loadConfig(); // from .claude-codex.json
const runId = `blind-audit-${Date.now()}`;
```

### Step 2: Initialize Directories

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset
mkdir -p docs/security docs/architecture docs/testing docs/reviews docs/performance reports
mkdir -p .task/${runId}/bundle-stage3 .task/${runId}/bundle-stage4 .task/${runId}/bundle-final
```

### Step 3: Create Run Metadata

Write `.task/<run_id>/run-metadata.json`:

```json
{
  "run_id": "<run_id>",
  "started_at": "ISO8601",
  "config": { ... },
  "stages": {
    "requirements": { "status": "pending" },
    "spec_write": { "status": "pending" },
    "spec_validate": { "status": "pending" },
    "implement": { "status": "pending" },
    "spec_compliance": { "status": "pending" },
    "exploit_hunt": { "status": "pending" },
    "redteam": { "status": "pending", "issues": [], "iterations": 0 },
    "final_gate": { "status": "pending" }
  }
}
```

### Step 4: Create Task Chain with Dependencies

```
TaskCreate: "STAGE 0: Codex Requirements"              -> T0 (blockedBy: [])
TaskCreate: "STAGE 1: Codex Spec Writing"              -> T1 (blockedBy: [T0])
TaskCreate: "STAGE 2: Spec Gate Validation"            -> T2 (blockedBy: [T1])
TaskCreate: "STAGE 3A: Claude Implementation (TDD)"    -> T3 (blockedBy: [T2])
TaskCreate: "STAGE 3B: Run Tests & Collect Reports"    -> T4 (blockedBy: [T3])
TaskCreate: "Generate Bundle Stage 3"                  -> T5 (blockedBy: [T2])
TaskCreate: "Generate Bundle Stage 4"                  -> T6 (blockedBy: [T4])
TaskCreate: "STAGE 3: Spec Compliance Review"          -> T7 (blockedBy: [T4, T5])
TaskCreate: "STAGE 4: Exploit Hunt Review"             -> T8 (blockedBy: [T6, T7])
TaskCreate: "Generate Final Bundle"                    -> T9 (blockedBy: [T8])
TaskCreate: "STAGE 6: Codex Final Gate"                -> T10 (blockedBy: [T9])
```

Save to `.task/pipeline-tasks.json`:

```json
{
  "run_id": "<run_id>",
  "stage_0_requirements": "T0-id",
  "stage_1_spec_write": "T1-id",
  "stage_2_spec_validate": "T2-id",
  "stage_3a_implement": "T3-id",
  "stage_3b_test_reports": "T4-id",
  "bundle_stage3": "T5-id",
  "bundle_stage4": "T6-id",
  "stage_3_spec_compliance": "T7-id",
  "stage_4_exploit_hunt": "T8-id",
  "bundle_final": "T9-id",
  "stage_6_final_gate": "T10-id"
}
```

---

## Stage Specifications

### STAGE 0: Codex Requirements Gathering

**Agent:** `requirements-gatherer-codex` (external - Codex CLI)
**Purpose:** Codex gathers requirements, defines acceptance criteria, and bounds scope.

**Output Artifacts:**

1. **`.task/user-story.json`**
   - Title and description (As a/I want/So that)
   - Functional requirements
   - Non-functional requirements (security, performance)
   - Constraints
   - Acceptance criteria (Given/When/Then format)
   - Scope (in-scope, out-of-scope, assumptions)
   - Test criteria for TDD

**Invocation:**
```
Task(
  subagent_type: "claude-codex:requirements-gatherer-codex",
  prompt: "[User's task description]"
)
```

The agent invokes:
```bash
node "{PLUGIN_ROOT}/scripts/codex-requirements.js" --plugin-root "{PLUGIN_ROOT}" --task "{TASK}"
```

**Block condition:** Missing user-story.json or incomplete acceptance criteria

---

### STAGE 1: Codex Spec Writing

**Agent:** `strategist-codex` (external - Codex CLI)
**Purpose:** Codex writes comprehensive specs with explicit invariants and acceptance criteria.

**Output Artifacts:**

1. **`docs/security/threat-model.md`**
   - Assets at risk (with max values)
   - Trust assumptions (roles, powers, constraints)
   - Attacker classes (external, insider, MEV, oracle)
   - Attack surfaces (entry points, callbacks)
   - **Enumerated invariants I1..In** (IC-*, IS-*, IA-*, IT-*, IB-*)
   - State machine / allowed transitions
   - **Explicit acceptance criteria** (AC-SEC-*, AC-FUNC-*)

2. **`docs/architecture/design.md`**
   - Module boundaries
   - External call policy
   - Error/event model
   - Storage layout rules
   - Upgrade strategy

3. **`docs/testing/test-plan.md`**
   - **Mapping table: invariant Ix -> tests Tx**
   - Attack simulations list
   - Coverage targets

**Artifact:** `.task/codex-spec.json`

---

### STAGE 2: Spec Gate Validation

**Purpose:** Validate spec completeness before implementation.

**Validates (Gate A):**
- [ ] All invariants numbered (IC-*, IS-*, IA-*, IT-*, IB-*)
- [ ] Every invariant has mapped test in test-plan.md
- [ ] Acceptance criteria are measurable (not vague)
- [ ] All 6 attack simulation categories present
- [ ] Storage layout documented
- [ ] External call policy documented

**Block if:** Any validation fails

---

### STAGE 3A: Claude Implementation (TDD)

**Agent:** `sc-implementer` (sonnet)
**Purpose:** Implement approved design using TDD with Foundry.

**Process:**
1. Read approved design artifacts
2. Write invariant tests FIRST
3. Write unit tests
4. Implement minimal code to pass
5. Run fuzz tests (min_fuzz_runs from config)

**Output:**
- Source code in `src/`
- Tests in `test/`
- `reports/forge-test.log`
- `reports/invariant-test.log` (if enabled)

---

### STAGE 3B: Run Tests & Collect Reports

**Purpose:** Generate test summaries for blind review bundles.

**Runs:**
```bash
forge test --summary > reports/test-summary.txt
forge snapshot --snap reports/.gas-snapshot
```

**Generates:**
- `reports/test-summary.md` - test names + PASS/FAIL only
- `reports/gas-summary.md` - function names + gas only

**Block if:** Tests fail or reports missing

---

### STAGE 3: Spec Compliance Review (BLIND TO CODE)

**Agent:** `spec-compliance-reviewer` (opus)
**Bundle:** `bundle-stage3/` (NO code)

**Reviewer sees:**
- threat-model.md, design.md, test-plan.md
- test-summary.md (names + results only)
- gas-summary.md

**Reviewer does NOT see:**
- Any `.sol` files
- Any implementation code
- Any git diff

**Output:** `docs/reviews/spec-compliance-review.md`

**Required Schema:**
```markdown
Decision: APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION

## Invariant-Test Mapping Audit
| Invariant | Status |
|-----------|--------|
| IC-1 | OK|MISSING_TEST|AMBIGUOUS |
...

## Acceptance Criteria Audit
| AC | MEASURABLE |
|----|------------|
| AC-SEC-1 | YES|NO |
...

## Required Changes
(Each starts with [CODEX] prefix)
- [CODEX] ...
```

**Loop:** If NEEDS_CHANGES -> codex_spec_fix -> re-validate -> re-review (same reviewer)

---

### STAGE 4: Exploit Hunt Review (BLIND TO SPEC NARRATIVE)

**Agent:** `exploit-hunter` (opus)
**Bundle:** `bundle-stage4/` (NO spec prose)

**Reviewer sees:**
- `invariants-list.md` (ONLY numbered invariants with formal expressions)
- `public-api.md` (interfaces extracted from code)
- Full source code (`src/`, `test/`)
- `slither-summary.md` (if available)

**Reviewer does NOT see:**
- threat-model.md prose (attack surface descriptions, trust assumptions)
- design.md narrative
- "Why" or "motivation" text

**Output:** `docs/reviews/exploit-hunt-review.md`

**Required Schema:**
```markdown
Decision: APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION

## Attempted Exploit Hypotheses
(at least 1 required, describe attack vector attempted)
- ...

## Confirmed Exploit Paths
| ID | Severity | Title | Reproduction |
|----|----------|-------|--------------|
| EH-1 | HIGH|MED|LOW | ... | ... |

## Invariant Coverage
| Invariant | Status |
|-----------|--------|
| IC-1 | COVERED|UNCLEAR|VIOLATED |
...

## Required Tests
(map to invariant I#)
- ...

## Economic/MEV Risks
- ...

## DoS/Gas Grief Risks
- ...
```

---

### STAGE 5: Red-Team Loop

**Purpose:** Iterate until ALL HIGH/MED issues from exploit hunt are CLOSED.

**Agent:** `redteam-verifier` (sonnet)

**Process:**
1. Parse exploit-hunt-review.md for HIGH/MED issues
2. For each issue:
   a. Create fix task
   b. Implementer patches
   c. Verifier confirms fix with regression test
   d. Mark CLOSED in issue log
3. Repeat until all HIGH/MED CLOSED

**Issue Log:** `docs/reviews/red-team-issue-log.md`

**Issue Format:**
```markdown
## RT-001
- **Severity:** HIGH|MED|LOW
- **Title:** ...
- **Description:** ...
- **Repro / Hypothesis:** ...
- **Expected Fix:** ...
- **Regression Test Required:** test/...
- **Status:** OPEN|FIXED_PENDING_VERIFY|CLOSED
- **Verifier Notes:** ...
```

**Gate E:** Blocks until ALL HIGH/MED have Status: CLOSED

**Max iterations:** `max_redteam_iterations` from config (default: 10)

---

### STAGE 6: Codex Final Gate

**Agent:** `final-gate-codex` (external - Codex CLI)
**Bundle:** `bundle-final/` (complete)

**Codex reviews:**
- All spec documents
- All implementation
- All review outputs
- Red-team issue log (all CLOSED)
- Static analysis results
- Gas evidence

**Output:** `docs/reviews/final-codex-gate.md`

**Required Schema:**
```markdown
Decision: APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION

## Gate Checklist
| Gate | Status |
|------|--------|
| Spec Completeness | PASS|FAIL |
| Tests/Fuzz/Invariant Evidence | PASS|FAIL |
| Static Analysis | PASS|FAIL |
| Blind Review Compliance | PASS|FAIL |
| Red-Team Issues Closed | PASS|FAIL |
| Gas Evidence Present | PASS|FAIL |

## Remaining Risks
(must be LOW only)
- ...

## Release Notes
- ...
```

**Block condition:** Pipeline NOT complete unless Codex outputs `APPROVED`

---

## Main Loop

```
while pipeline not complete:
    1. TaskList() -> find task where blockedBy empty AND status pending
    2. TaskUpdate(task_id, status: "in_progress")
    3. If bundle generation task:
       - Run appropriate generate-bundle script
       - Validate bundle with bundle-validator
    4. If review task:
       - Spawn reviewer agent with appropriate bundle
       - Validate output schema
    5. If gate fails OR review returns NEEDS_*:
       - Create fix task
       - Create re-run task (blocked by fix)
       - Update next task's blockedBy
    6. If gate passes AND review APPROVED:
       - TaskUpdate(task_id, status: "completed")
    7. Continue to next task
```

---

## Agent Reference

| Stage | Task | Agent | Model | Output |
|-------|------|-------|-------|--------|
| 0 | Requirements | requirements-gatherer-codex | external | user-story.json |
| 1 | Spec Writing | strategist-codex | external | threat-model, design, test-plan |
| 3A | Implementation | sc-implementer | sonnet | impl-result.json |
| 3 | Spec Compliance | spec-compliance-reviewer | opus | spec-compliance-review.md |
| 4 | Exploit Hunt | exploit-hunter | opus | exploit-hunt-review.md |
| 5 | Fix Verification | redteam-verifier | sonnet | red-team-issue-log.md |
| 6 | Final Gate | final-gate-codex | external | final-codex-gate.md |

### Spawning Workers

```
# For Codex Requirements (external)
Task(
  subagent_type: "claude-codex:requirements-gatherer-codex",
  prompt: "[User's task description]"
)

# For Codex Spec Writing (external)
Task(
  subagent_type: "claude-codex:strategist-codex",
  prompt: "[Spec writing instructions + user requirements from user-story.json]"
)

# For Claude/Opus
Task(
  subagent_type: "claude-codex:spec-compliance-reviewer",
  model: "opus",
  prompt: "[Review instructions + bundle path]"
)
```

---

## Bundle Generation Commands

### Generate Stage 3 Bundle (NO CODE)
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-stage3.js" --run-id <run_id>
```

### Generate Stage 4 Bundle (NO SPEC PROSE)
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-stage4.js" --run-id <run_id>
```

### Generate Final Bundle
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-final.js" --run-id <run_id>
```

### Extract Invariants List
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/extract-invariants-list.js" --input docs/security/threat-model.md --output <output-path>
```

### Extract Public API
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/extract-public-api.js" --src src/ --output <output-path>
```

---

## Loop-Back Handling

### STAGE 3 (Spec Compliance) returns NEEDS_CHANGES:
```
Create: T7.1 "Fix Spec - Codex v1" (blockedBy: [T7])
  -> Codex updates docs based on reviewer feedback
Create: T7.2 "Re-validate Spec" (blockedBy: [T7.1])
Create: T7.3 "Spec Compliance Review v2" (blockedBy: [T7.2])
Update: T8 addBlockedBy: [T7.3]
```

### STAGE 4 (Exploit Hunt) finds HIGH/MED:
```
For each HIGH/MED issue:
  Create: T8.N.1 "Fix RT-00N" (blockedBy: [T8])
  Create: T8.N.2 "Verify RT-00N" (blockedBy: [T8.N.1])
Create: T8.final "Red-Team Closure Check" (blockedBy: [all verify tasks])
Update: T9 addBlockedBy: [T8.final]
```

---

## Terminal States

| State | Meaning | Action |
|-------|---------|--------|
| `complete` | Codex approved, all gates green | Report success |
| `spec_rejected` | Spec review failed after max iterations | Escalate to user |
| `exploit_unfixed` | HIGH/MED not fixed after max iterations | Escalate to user |
| `gate_failed` | Gate artifact missing/invalid | Fix and retry |
| `blindness_violation` | Bundle contains forbidden content | Block and report |
| `codex_rejected` | Final gate rejected | Escalate to user |

---

## Important Rules

1. **Blindness is structural** - Enforced by bundle generation, validated by hooks
2. **Codex leads design** - STAGE 1 produces all strategy artifacts
3. **Spec compliance is blind to code** - Reviewers validate specs against test RESULTS only
4. **Exploit hunt is blind to spec narrative** - Reviewers find bugs in code, not docs
5. **Red-team must close all HIGH/MED** - No exceptions
6. **Same-reviewer re-review** - Fixes validated by same agent
7. **Codex is final gate** - Pipeline NOT complete without Codex APPROVED
8. **Max iterations enforced** - Per stage, then escalate

---

## How to Run

```bash
# Start the pipeline
/claude-codex:blind-audit-sc <task description>

# Example
/claude-codex:blind-audit-sc "Implement a secure ERC-4626 vault with flash loan protection"
```

**Required tools:**
- Foundry (forge, cast)
- Slither (recommended)
- Codex CLI (required for STAGE 1 and 6)
- Bun (for scripts)

---

## Emergency Controls

If stuck:

1. **Check task state:** `TaskList()` to see blocked tasks
2. **Check bundles:** Read `.task/<run_id>/bundle-*` directories
3. **Check issue log:** Read `docs/reviews/red-team-issue-log.md`
4. **Reset pipeline:** `"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset`
5. **Manual override:** Set `blind_enforcement: "warn"` (not recommended for production)

---

## Verification Checklist

### Test the Pipeline
1. Run `/claude-codex:blind-audit-sc "Implement ERC-4626 vault with flash loan protection"`
2. Verify Stage 3 bundle contains NO code (check `bundle-stage3/`)
3. Verify Stage 4 bundle contains NO threat-model prose (check `bundle-stage4/`)
4. Inject a test HIGH severity issue and verify red-team loop triggers
5. Verify final gate blocks until all HIGH/MED CLOSED

### Artifact Verification
| Stage | Expected Artifacts |
|-------|-------------------|
| 1 | `docs/security/threat-model.md`, `docs/architecture/design.md`, `docs/testing/test-plan.md` |
| 3A | Code + tests, `reports/forge-test.log` |
| 3 | `docs/reviews/spec-compliance-review.md` |
| 4 | `docs/reviews/exploit-hunt-review.md` |
| 5 | `docs/reviews/red-team-issue-log.md` |
| 6 | `docs/reviews/final-codex-gate.md` |
