---
name: blind-audit-sc
description: Blind-audit pipeline for fund-sensitive smart contracts. Enforces strict separation - spec reviewers cannot see code, exploit hunters cannot see spec narrative. Red-team loop until all HIGH/MED issues CLOSED. Includes Adversarial Codex ↔ Opus Mode.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Blind-Audit Smart Contract Pipeline

You coordinate a **6-stage blind-audit pipeline** (with **Adversarial Mode** substages) for fund-sensitive smart contracts with **strict blindness enforcement** between reviewers.

**Key Blindness Rules:**
- **Stage 0 (Requirements)** Codex gathers requirements with acceptance criteria
- **Stage 3 (Spec Compliance)** reviews specs WITHOUT seeing code
- **Stage 4 (Exploit Hunt)** reviews code WITHOUT seeing spec narrative
- **Stage 4A-4C (Adversarial Mode)** Opus and Codex work independently, then dispute
- **Stage 5 (Red-Team Loop)** iterates until all HIGH/MED issues CLOSED

**Adversarial Mode (Stages 4A-4C):**
- **Stage 4A** Opus Contrarian Attack Plan (blind to spec prose AND Codex output)
- **Stage 4B** Codex Deep Exploit Hunt (blind to spec prose AND Opus output)
- **Stage 4C** Dispute Resolution Duel (sees both, resolves disagreements)

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
6. **Coverage-first execution** - Do not stop at first bug; maximize High/Med discovery coverage before closure

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
    +=================================+
    |     ADVERSARIAL MODE (4A-4C)    |
    +=================================+
                    |
    +---------------+---------------+
    |                               |
    v                               v
BUNDLE-STAGE4A                BUNDLE-STAGE4B
(NO spec prose)               (NO spec prose)
(NO Codex output)             (NO Opus output)
    |                               |
    v                               v
STAGE 4A: Opus Attack Plan    STAGE 4B: Codex Deep Exploit
(Contrarian hypotheses)       (Deep paths + refutations)
    |                               |
    +---------------+---------------+
                    |
                    v
              BUNDLE-STAGE4C
              (Both reviews + code + invariants)
              (NO spec prose)
                    |
                    v
              STAGE 4C: Dispute Resolution
              (Opus=PROSECUTOR, Codex=DEFENDER)
              |       |       |
              v       v       v
           CONFIRMED  DISPROVEN  UNCLEAR
              |          |         |
              v          |         v
         RT Issue     (done)   Add Test Task
              |                    |
              +--------------------+
              |                    |
              v                    v
    +-----------------+    (Rerun 4A+4B+4C)
    |                 |         |
    v                 |         |
STAGE 5: Red-Team Loop <--------+
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
T5: bundle_generate_stage3     (blockedBy: [T4])
T6: bundle_generate_stage4     (blockedBy: [T4])
T7: spec_compliance_review     (blockedBy: [T4, T5])
    -> Loop if NEEDS_CHANGES: codex_spec_fix -> re-validate -> re-review
T8: exploit_hunt_review        (blockedBy: [T6, T7])
    -> Loop if HIGH/MED issues: red_team_patch_game until all CLOSED

=== ADVERSARIAL MODE TASKS (if adversarial_mode: true) ===

T8a: bundle_generate_stage4a    (blockedBy: [T4])
T8b: bundle_generate_stage4b    (blockedBy: [T4])
     NOTE: T8a and T8b MUST be isolated from each other
T8c: opus_attack_plan           (blockedBy: [T8a])
     Output: docs/reviews/opus-attack-plan.md
T8d: codex_deep_exploit         (blockedBy: [T8b])
     Output: docs/reviews/codex-deep-exploit-review.md
     NOTE: MUST NOT see T8c output
T8e: bundle_generate_stage4c    (blockedBy: [T8c, T8d])
T8f: dispute_resolution         (blockedBy: [T8e])
     Output: docs/reviews/dispute-resolution.md
     -> If CONFIRMED: create RT issues, proceed to T8
     -> If UNCLEAR: create add-test task, rerun T8a-T8f (max 3 rounds)
     -> If all DISPROVEN: proceed to T9

=== END ADVERSARIAL MODE ===

T8g: consolidate_findings       (blockedBy: [T8, T8f] if adversarial; [T8] otherwise)
T8h: coverage_tracking          (blockedBy: [T8g])
T8i: stage_5_redteam_loop      (blockedBy: [T8h])
     Agent: redteam-verifier
     -> Loop: patch HIGH/MED issues, run exploit-verify + patch-verify until all CLOSED
     -> Gate E enforced by redteam-closure-validator.js

T9: bundle_generate_final      (blockedBy: [T8i])
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

## Adversarial Mode Blindness Rules

### Stage 4A Bundle (Opus Attack Plan) - NO SPEC PROSE, NO CODEX OUTPUT

**Script:** `scripts/generate-bundle-stage4a.js`

**Includes:**
- `invariants-list.md` (ONLY numbered invariants - NO prose)
- `public-api.md` (interfaces only)
- Full source code (`src/**/*.sol`)
- Full test code (`test/**/*.sol`)
- `slither-summary.md` (if available)

**Excludes:**
- `docs/security/threat-model.md` prose
- `docs/architecture/design.md` narrative
- `docs/reviews/codex-deep-exploit-review.md` (ISOLATION)
- Any Codex output artifacts

**Output:** `.task/<run_id>/bundle-stage4a/`

### Stage 4B Bundle (Codex Deep Exploit) - NO SPEC PROSE, NO OPUS OUTPUT

**Script:** `scripts/generate-bundle-stage4b.js`

**Includes:**
- `invariants-list.md` (ONLY numbered invariants - NO prose)
- `public-api.md` (interfaces only)
- Full source code (`src/**/*.sol`)
- Full test code (`test/**/*.sol`)
- `slither-summary.md` (if available)

**Excludes:**
- `docs/security/threat-model.md` prose
- `docs/architecture/design.md` narrative
- `docs/reviews/opus-attack-plan.md` (ISOLATION)
- Any Opus output artifacts

**Output:** `.task/<run_id>/bundle-stage4b/`

### Stage 4C Bundle (Dispute Resolution) - NO SPEC PROSE, BOTH REVIEWS

**Script:** `scripts/generate-bundle-stage4c.js`

**Includes:**
- `invariants-list.md` (ONLY numbered invariants - NO prose)
- `public-api.md` (interfaces only)
- Full source code (`src/**/*.sol`)
- Full test code (`test/**/*.sol`)
- `docs/reviews/opus-attack-plan.md` (NOW VISIBLE)
- `docs/reviews/codex-deep-exploit-review.md` (NOW VISIBLE)
- `slither-summary.md` (if available)

**Excludes:**
- `docs/security/threat-model.md` prose (STILL BLIND)
- `docs/architecture/design.md` narrative (STILL BLIND)

**Output:** `.task/<run_id>/bundle-stage4c/`

---

## EVMbench-Aligned Coverage Enforcement (Mandatory)

These requirements are **mandatory** for pipeline completion. Hook validators (`review-validator.js`) block if artifacts are missing or malformed.

### 1) Discovery Scoreboard (Stage 4 — REQUIRED)

The **exploit-hunter** agent (Stage 4) and **opus-attack-planner** (Stage 4A) MUST write:
- `docs/reviews/discovery-scoreboard.md`
- `.task/discovery-scoreboard.json`

**Hook enforcement:** `review-validator.js` → `validateDiscoveryScoreboard()` blocks if missing/malformed.

Minimum JSON fields:
```json
{
  "entrypoints_total": 0,
  "entrypoints_reviewed": 0,
  "high_med_candidates": 0,
  "validated_high_med": 0,
  "hint_level": "none"
}
```

Valid `hint_level` values: `"none"`, `"low"`, `"medium"`, `"high"`

### 2) Hint Escalation Ladder (when stalled)

If no new validated High/Med issues are found after a full Stage 4 pass, escalate in order:
1. `low` hints: specific files/modules to inspect
2. `medium` hints: mechanism hints (reentrancy ordering, auth path, accounting drift, etc.)
3. `high` hints: exact grader success checks for exploit validation

**Script:** `bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-hints.js" --run-id <run_id> --source opus --target codex`

Record `hint_level` and reason in `discovery-scoreboard.json`.

### 3) Exploit Replay Hygiene (Stage 5 — REQUIRED)

The **redteam-verifier** agent (Stage 5) MUST write `.task/exploit-replay.json` for each confirmed issue:

**Hook enforcement:** `review-validator.js` → `validateExploitReplay()` blocks if missing/malformed.

**Scripts:**
- `bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-exploit-verify.js" --run-id <run_id>` — runs exploit via Anvil (live-chain default per EVMbench; override with `exploit_verification.live_chain.enable: false`)
- `bun "${CLAUDE_PLUGIN_ROOT}/scripts/replay-transactions.js"` — replays txs on fresh chain
- `bun "${CLAUDE_PLUGIN_ROOT}/scripts/grade-exploit.js"` — grades via wallet delta

**Minimum JSON shape:**
```json
{
  "replays": [
    {
      "finding_id": "RT-001",
      "verdict": "EXPLOIT_BLOCKED",
      "pre_balance": "100.0",
      "post_balance": "100.0",
      "grading_mode": "replay-isolated"
    }
  ]
}
```

Required per replay: `finding_id` + `verdict` (or `status`). Missing = hook blocks.

### 4) Closure Criteria (Stage 5 gate — ENFORCED)

Stage 5 MUST NOT close unless:
- All validated High/Med issues have patch evidence (`.task/patch-closure.json` if calibration tasks used)
- All validated High/Med issues have exploit replay evidence (`.task/exploit-replay.json`)
- Discovery scoreboard shows full entrypoint coverage or explicit documented exclusions
- Hook validators pass for all recently-written calibration artifacts

---

## Gate Validations

| Gate | Name | Validates | Hook |
|------|------|-----------|------|
| A | Spec Completeness | Invariants numbered I1-In, test mapping exists, AC measurable | `blind-audit-gate-validator.js` |
| B | Evidence Presence | test-summary.md, gas-summary.md exist, forge tests pass | `blind-audit-gate-validator.js` |
| C | Bundle Correctness | Stage 3 has NO code; Stage 4 has NO spec prose | `bundle-validator.js` |
| D | Review Schema | Review outputs conform to strict schemas | `blind-audit-gate-validator.js` |
| E | Red-Team Closure | All HIGH/MED CLOSED with regression test references | `redteam-closure-validator.js` |
| F | Calibration Artifacts | discovery-scoreboard.json, exploit-replay.json valid | `review-validator.js` |
| G | Final Gate | All gates green, Codex outputs APPROVED | `blind-audit-gate-validator.js` |

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
    "require_regression_tests": true,
    "gate_strictness": "high",
    "adversarial": {
      "adversarial_mode": true,
      "min_attack_hypotheses": 8,
      "min_economic_hypotheses": 2,
      "min_dos_hypotheses": 2,
      "min_refuted_hypotheses": 1,
      "min_false_positives_invalidated": 3,
      "dispute_max_rounds": 3,
      "opus_model": "opus",
      "codex_timeout_ms": 1200000,
      "require_reproduction_artifacts": true,
      "auto_create_rt_issues": true
    }
  },
  "exploit_verification": {
    "live_chain": {
      "enable": true
    }
  }
}
```

### Adversarial Mode Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `adversarial_mode` | `true` | Enable Adversarial Codex ↔ Opus Mode |
| `min_attack_hypotheses` | `8` | Minimum total hypotheses from Opus |
| `min_economic_hypotheses` | `2` | Minimum Economic/MEV hypotheses |
| `min_dos_hypotheses` | `2` | Minimum DoS/Gas Grief hypotheses |
| `min_refuted_hypotheses` | `1` | Minimum refuted hypotheses from Codex |
| `min_false_positives_invalidated` | `3` | Minimum false positives invalidated |
| `dispute_max_rounds` | `3` | Max rerun rounds for UNCLEAR disputes |
| `codex_timeout_ms` | `1200000` | Codex CLI timeout (20 minutes) |
| `require_reproduction_artifacts` | `true` | Require tests for all disputes |
| `auto_create_rt_issues` | `true` | Auto-create RT issues for CONFIRMED |

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
TaskCreate: "Generate Bundle Stage 3"                  -> T5 (blockedBy: [T4])
TaskCreate: "Generate Bundle Stage 4"                  -> T6 (blockedBy: [T4])
TaskCreate: "STAGE 3: Spec Compliance Review"          -> T7 (blockedBy: [T4, T5])
TaskCreate: "STAGE 4: Exploit Hunt Review"             -> T8 (blockedBy: [T6, T7])

# === If adversarial_mode: true ===
TaskCreate: "Generate Bundle Stage 4A"                 -> T8a (blockedBy: [T4])
TaskCreate: "Generate Bundle Stage 4B"                 -> T8b (blockedBy: [T4])
TaskCreate: "STAGE 4A: Opus Attack Plan"               -> T8c (blockedBy: [T8a])
TaskCreate: "STAGE 4B: Codex Deep Exploit"             -> T8d (blockedBy: [T8b])
TaskCreate: "Generate Bundle Stage 4C"                 -> T8e (blockedBy: [T8c, T8d])
TaskCreate: "STAGE 4C: Dispute Resolution"             -> T8f (blockedBy: [T8e])
TaskCreate: "STAGE 4.5: Consolidate Findings"          -> T8g (blockedBy: [T8, T8f])
TaskCreate: "STAGE 4.5: Coverage Tracking"             -> T8h (blockedBy: [T8g])
# === Else (adversarial_mode: false) ===
TaskCreate: "STAGE 4.5: Consolidate Findings"          -> T8g (blockedBy: [T8])
TaskCreate: "STAGE 4.5: Coverage Tracking"             -> T8h (blockedBy: [T8g])
# === End conditional ===

TaskCreate: "STAGE 5: Red-Team Loop"                   -> T8i (blockedBy: [T8h])
TaskCreate: "Generate Final Bundle"                    -> T9 (blockedBy: [T8i])
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
  "bundle_stage4a": "T8a-id",
  "bundle_stage4b": "T8b-id",
  "stage_4a_opus_attack": "T8c-id",
  "stage_4b_codex_exploit": "T8d-id",
  "bundle_stage4c": "T8e-id",
  "stage_4c_dispute_resolution": "T8f-id",
  "consolidate_findings": "T8g-id",
  "coverage_tracking": "T8h-id",
  "stage_5_redteam_loop": "T8i-id",
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
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-requirements.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}" --task "${TASK}"
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

---

## Adversarial Mode Stages (4A-4C)

### STAGE 4A: Opus Contrarian Attack Plan

**Agent:** `opus-attack-planner` (opus)
**Bundle:** `bundle-stage4a/` (NO spec prose, NO Codex output)

**Purpose:** Opus generates adversarial attack hypotheses independently.

**HARD REQUIREMENTS:**
- Minimum 5 attack hypotheses (configurable via `min_attack_hypotheses`)
- Minimum 2 Economic/MEV hypotheses (configurable via `min_economic_hypotheses`)
- Minimum 2 DoS/Gas Grief hypotheses (configurable via `min_dos_hypotheses`)
- Each hypothesis MUST have: preconditions, attack steps, invariant mapping, demonstration test

**Output:** `docs/reviews/opus-attack-plan.md`

**Artifact:** `.task/<run_id>/opus-attack-plan.json`

**Invocation:**
```
Task(
  subagent_type: "claude-codex:opus-attack-planner",
  model: "opus",
  prompt: "[Attack plan instructions + bundle path]"
)
```

---

### STAGE 4B: Codex Deep Exploit Hunt

**Agent:** `codex-deep-exploit-hunter` (external - Codex CLI)
**Bundle:** `bundle-stage4b/` (NO spec prose, NO Opus output)

**Purpose:** Codex performs deep exploit analysis with cross-module reasoning.

**HARD REQUIREMENTS:**
- Minimum 1 refuted hypothesis with evidence (proves rigorous testing)
- Minimum 3 false positive invalidations with code references
- Must NOT see Opus attack plan (isolation enforced)

**Output:** `docs/reviews/codex-deep-exploit-review.md`

**Artifact:** `.task/<run_id>/codex-deep-exploit-review.json`

**Invocation:**
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-deep-exploit.js" --run-id <run_id> --timeout 1200000
```

---

### STAGE 4C: Dispute Resolution Duel

**Agent:** `dispute-resolver` (opus or sonnet)
**Bundle:** `bundle-stage4c/` (NO spec prose, BOTH reviews visible)

**Purpose:** Resolve disagreements between Opus and Codex via reproduction evidence.

**ROLES:**
- **Opus = PROSECUTOR**: Argues exploits are real, demands reproduction
- **Codex = DEFENDER**: Tries to refute or narrow preconditions; if can't refute, proposes minimal patch

**DISPUTE SET:**
1. Top 5 risks from Opus attack plan
2. Top 5 risks from Codex deep review
3. Any risk where severity disagrees (HIGH/MED vs LOW/NONE)

**VERDICT OPTIONS:**
| Verdict | Meaning | Required Action |
|---------|---------|-----------------|
| CONFIRMED | Exploit is real | Create RT issue (HIGH/MED), proceed to Stage 5 |
| DISPROVEN | Exploit blocked | Document refutation evidence |
| UNCLEAR | Need more evidence | Create add-test task, rerun 4A+4B+4C |

**REPRODUCTION ARTIFACTS (required for each dispute):**
- Foundry regression test, OR
- Invariant test, OR
- Forked simulation plan

**Output:** `docs/reviews/dispute-resolution.md`

**Artifact:** `.task/<run_id>/dispute-resolution.json`

**Loop Behavior:**
- CONFIRMED disputes → Create RT issues, proceed to Stage 5
- UNCLEAR disputes → Create add-test tasks, rerun 4A+4B+4C (max `dispute_max_rounds` iterations)
- All DISPROVEN → Proceed to Stage 5 (may have no RT issues)

---

### STAGE 4.5: Findings Consolidation + Coverage Check

**Purpose:** Merge all detection findings into unified set and check coverage.

**Step 1: Consolidate Findings**
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/consolidate-findings.js" --run-id <run_id>
```

Collects HIGH/MED from: exploit-hunt (Stage 4), attack-plan (Stage 4A), deep-exploit (Stage 4B), confirmed disputes (Stage 4C). Deduplicates and writes `consolidated-findings.json` + initial `red-team-issue-log.md`.

**Step 2: Coverage Tracking**
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-tracker.js" --run-id <run_id> --threshold 90
```

If coverage < threshold, generates `coverage-hints.json`. Orchestrator may create a hinted re-detection task:
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-hints.js" --run-id <run_id> --source merged --target codex --level medium
```

**Output:**
- `.task/<run_id>/consolidated-findings.json`
- `.task/<run_id>/coverage-report.json`
- `.task/<run_id>/coverage-hints.json` (if below threshold)
- `docs/reviews/red-team-issue-log.md`

---

### STAGE 5: Red-Team Loop

**Purpose:** Iterate until ALL HIGH/MED issues from detection stages are CLOSED.

**Agent:** `redteam-verifier` (sonnet)

**Process:**
1. Parse `.task/<run_id>/consolidated-findings.json` for all HIGH/MED issues from detection stages.
   Fallback: parse `docs/reviews/exploit-hunt-review.md` if consolidation not available.
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

### POST-PIPELINE: Benchmark Scoring (Optional)

If ground truth is available (e.g., from `benchmarks/`), score detection quality:
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/match-findings.js" \
  --detected .task/<run_id>/consolidated-findings.json \
  --ground-truth benchmarks/contracts/<bench-id>/ground-truth.json
```

Reports precision, recall, F1 with three-tier matching (exact + broad + semantic judge).

---

## Main Loop

```
while pipeline not complete:
    1. TaskList() -> find task where blockedBy empty AND status pending
    2. TaskUpdate(task_id, status: "in_progress")
    3. If bundle generation task:
       - Run appropriate generate-bundle script
       - Validate bundle with bundle-validator (verify blindness constraints)
       - For stage4a: verify NO Codex output in bundle
       - For stage4b: verify NO Opus output in bundle
    4. If review task:
       - Spawn reviewer agent with appropriate bundle
       - Validate output schema
    5. If gate fails OR review returns NEEDS_*:
       - Create fix task
       - Create re-run task (blocked by fix)
       - Update next task's blockedBy
    6. If gate passes AND review APPROVED:
       - TaskUpdate(task_id, status: "completed")
    7. If adversarial_mode AND T8 just completed:
       - Create T8a-T8f tasks (if not already created in Step 4)
       - T8a, T8b run in PARALLEL (both blockedBy: [T4])
       - T8c (opus-attack-planner) sees bundle-stage4a only
       - T8d (codex-deep-exploit-hunter) sees bundle-stage4b only
       - T8e (bundle-stage4c) blocked until BOTH T8c AND T8d complete
       - T8f (dispute-resolver) sees bundle-stage4c (both reviews)
       - Update T8g blockedBy to include T8f
    8. If T8f (dispute) returns UNCLEAR disputes:
       - Create add-test tasks for each UNCLEAR dispute
       - Create rerun tasks: T-D{N}-4a, T-D{N}-4b, T-D{N}-4c
       - Max dispute_max_rounds (default: 3) reruns
    9. Continue to next task
```

---

## Agent Reference

| Stage | Task | Agent | Model | Output |
|-------|------|-------|-------|--------|
| 0 | Requirements | requirements-gatherer-codex | external | user-story.json |
| 1 | Spec Writing | strategist-codex | external | threat-model, design, test-plan |
| 2 | Spec Gate Validation | blind-audit-gate-validator.js | script | gate-validation result |
| 3A | Implementation | sc-implementer | sonnet | impl-result.json |
| 3 | Spec Compliance | spec-compliance-reviewer | opus | spec-compliance-review.md |
| 4 | Exploit Hunt | exploit-hunter | opus | exploit-hunt-review.md, **discovery-scoreboard.json** |
| **4A** | **Opus Attack Plan** | **opus-attack-planner** | **opus** | **opus-attack-plan.md**, **discovery-scoreboard.json** |
| **4B** | **Codex Deep Exploit** | **codex-deep-exploit-hunter** | **external** | **codex-deep-exploit-review.md**, **discovery-scoreboard.json** |
| **4C** | **Dispute Resolution** | **dispute-resolver** | **opus** | **dispute-resolution.md** |
| **4.5** | **Consolidate + Coverage** | **consolidate-findings.js + coverage-tracker.js** | **script** | **consolidated-findings.json, coverage-report.json** |
| 5 | Fix Verification | redteam-verifier | sonnet | red-team-issue-log.md, **exploit-replay.json** |
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

### Generate Stage 4A Bundle (NO SPEC PROSE, NO CODEX OUTPUT)
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-stage4a.js" --run-id <run_id>
```

### Generate Stage 4B Bundle (NO SPEC PROSE, NO OPUS OUTPUT)
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-stage4b.js" --run-id <run_id>
```

### Generate Stage 4C Bundle (NO SPEC PROSE, BOTH REVIEWS)
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-stage4c.js" --run-id <run_id>
```

### Consolidate All Detection Findings
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/consolidate-findings.js" --run-id <run_id>
```

### Run Coverage Check
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/coverage-tracker.js" --run-id <run_id> --threshold 90
```

### Invoke Codex Deep Exploit Hunt
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-deep-exploit.js" --run-id <run_id> --timeout 1200000
```

### Generate Final Bundle
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-bundle-final.js" --run-id <run_id>
```

### Run Detect Pipeline (Codex automated + Opus findings merge)
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/run-detect-pipeline.js" --run-id <run_id> --codex-timeout 900000
```

### Generate Cross-Model Hints
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-hints.js" --run-id <run_id> --source opus --target codex
bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-hints.js" --run-id <run_id> --source codex --target opus
```

### Run Exploit Verification (Foundry test or live chain)
```bash
# Foundry test mode (default)
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-exploit-verify.js" --run-id <run_id>
# Live chain mode (Anvil + replay-isolated grading)
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-exploit-verify.js" --run-id <run_id> --live-chain
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

### STAGE 4C (Dispute Resolution) has CONFIRMED disputes:
```
For each CONFIRMED HIGH/MED dispute:
  Create RT issue in docs/reviews/red-team-issue-log.md
  Add to .task/<run_id>/dispute-resolution.json
Proceed to STAGE 5 (Red-Team Loop)
```

### STAGE 4C (Dispute Resolution) has UNCLEAR disputes:
```
For each UNCLEAR dispute:
  Create: T-D{N}-test "Add test for D-{N}" (blockedBy: [T8f])
  Create: T-D{N}-4a "Rerun Opus Attack Plan" (blockedBy: [T-D{N}-test])
  Create: T-D{N}-4b "Rerun Codex Deep Exploit" (blockedBy: [T-D{N}-test])
  Create: T-D{N}-4c "Rerun Dispute Resolution" (blockedBy: [T-D{N}-4a, T-D{N}-4b])

If rerun_round >= dispute_max_rounds:
  Escalate to user: "Max dispute rounds reached"
```

### Adversarial Loop Flow
```
STAGE 4A (Opus) ─────────────────────┐
                                      │
                                      ├──> STAGE 4C (Dispute)
                                      │         │
STAGE 4B (Codex) ────────────────────┘         │
         ^                                      │
         │                                      v
         │    ┌─────────────────────────────────┤
         │    │                                 │
         │    v                                 v
         │  CONFIRMED                      UNCLEAR
         │    │                                 │
         │    v                                 v
         │  RT Issue ─> Stage 5           Add Test Task
         │                                      │
         └──────────────────────────────────────┘
                      (max 3 rounds)
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

### Test Adversarial Mode
1. Verify Stage 4A bundle excludes Codex output (check `bundle-stage4a/MANIFEST.json`)
2. Verify Stage 4B bundle excludes Opus output (check `bundle-stage4b/MANIFEST.json`)
3. Verify Stage 4C bundle includes BOTH reviews (check `bundle-stage4c/reviews/`)
4. Verify Opus attack plan has min 2 Economic/MEV + 2 DoS hypotheses
5. Verify Codex review has min 1 refuted hypothesis + 3 false positive invalidations
6. Verify CONFIRMED disputes create RT issues
7. Verify UNCLEAR disputes trigger rerun (max 3 rounds)

### Artifact Verification
| Stage | Expected Artifacts |
|-------|-------------------|
| 1 | `docs/security/threat-model.md`, `docs/architecture/design.md`, `docs/testing/test-plan.md` |
| 3A | Code + tests, `reports/forge-test.log` |
| 3 | `docs/reviews/spec-compliance-review.md` |
| 4 | `docs/reviews/exploit-hunt-review.md` |
| **4A** | **`docs/reviews/opus-attack-plan.md`**, **`.task/<run_id>/opus-attack-plan.json`** |
| **4B** | **`docs/reviews/codex-deep-exploit-review.md`**, **`.task/<run_id>/codex-deep-exploit-review.json`** |
| **4C** | **`docs/reviews/dispute-resolution.md`**, **`.task/<run_id>/dispute-resolution.json`** |
| 5 | `docs/reviews/red-team-issue-log.md` |
| 6 | `docs/reviews/final-codex-gate.md` |

### Bundle Contents Verification

| Bundle | MUST Include | MUST Exclude |
|--------|--------------|--------------|
| bundle-stage3 | threat-model.md, design.md, test-plan.md, test-summary.md | ALL .sol files |
| bundle-stage4 | invariants-list.md, public-api.md, src/*.sol, test/*.sol | threat-model.md prose |
| **bundle-stage4a** | invariants-list.md, public-api.md, src/*.sol, test/*.sol | threat-model.md prose, **Codex output** |
| **bundle-stage4b** | invariants-list.md, public-api.md, src/*.sol, test/*.sol | threat-model.md prose, **Opus output** |
| **bundle-stage4c** | invariants-list.md, opus-attack-plan.md, codex-deep-exploit-review.md | threat-model.md prose |
| bundle-final | ALL from stage3+stage4+reviews+red-team-log | (none) |
