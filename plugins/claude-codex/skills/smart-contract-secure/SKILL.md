---
name: smart-contract-secure
description: Security-first smart contract pipeline. Codex leads design/strategy, Claude implements with TDD, Opus reviews architecture, Codex final approval. For fund-sensitive contracts.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Smart Contract Security Pipeline

You coordinate a **security-first pipeline** for fund-sensitive smart contracts with **Codex as design lead and final approver**.

**Role Order:**
1. **Codex** = Design/Strategy lead (threat model, architecture, test plan)
2. **Opus** = Design review (architecture/security validation)
3. **Claude (Sonnet)** = Implementation with TDD
4. **Static Analysis** = Slither/Semgrep
5. **Gas/Performance** = Optimization with evidence
6. **Final Gate** = Sonnet → Opus → **Codex** (must approve)

**Task directory:** `${CLAUDE_PROJECT_DIR}/.task/`
**Reports directory:** `${CLAUDE_PROJECT_DIR}/reports/`
**Docs directory:** `${CLAUDE_PROJECT_DIR}/docs/`
**Agents location:** `${CLAUDE_PLUGIN_ROOT}/agents/`
**Templates location:** `${CLAUDE_PLUGIN_ROOT}/templates/`

---

## Non-Negotiable Principles

1. **Security is a hard constraint** - Gas/perf optimization only AFTER correctness + invariants proven
2. **Evidence-based gates** - Every stage produces verifiable artifacts
3. **Enforceable pipeline** - Tasks cannot be skipped; hooks block if criteria not met
4. **Evidence-based approval** - All decisions based on CI outputs, test results, analysis reports
5. **Codex leads and closes** - Codex designs strategy, Codex gives final approval

---

## Pipeline Architecture

```
GATE 0: Codex Design/Strategy
    ↓ threat-model.md, design.md, test-plan.md
GATE 1: Opus Design Review
    ↓ design-review-opus.md (APPROVED required, loops back if NEEDS_CHANGES)
GATE 2: Claude Implementation (TDD)
    ↓ Source code + reports/forge-test.log
GATE 3: Static Analysis
    ↓ reports/slither.json + suppressions.md
GATE 4: Gas/Performance
    ↓ reports/gas-snapshots.md + perf-report.md
FINAL GATE: Multi-Review
    ↓ Sonnet → Opus → Codex (APPROVED required)
```

| Component | Role |
|-----------|------|
| **Tasks** (primary) | Structural enforcement via `blockedBy`, audit trail |
| **Gate Validator Hook** | Validates artifacts exist and meet schema |
| **SubagentStop Hook** | Validates reviewer outputs, blocks if incomplete |
| **Main Thread** | Orchestrates gates, handles loops, creates fix tasks |

---

## Pipeline Initialization

### Step 1: Load Configuration

Read `.claude-codex.json` from project root (or use defaults):

```json
{
  "smart_contract_secure": {
    "enable_invariants": true,
    "enable_slither": true,
    "enable_semgrep": false,
    "fuzz_runs": 5000,
    "gate_strictness": "high",
    "required_coverage": 80,
    "max_iterations": 10
  }
}
```

### Step 2: Initialize Directories

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset
mkdir -p docs/security docs/architecture docs/testing docs/performance docs/reviews reports
```

### Step 3: Create Task Chain with Dependencies

```
TaskCreate: "GATE 0: Codex Design/Strategy"           → T1 (blockedBy: [])
TaskCreate: "GATE 1: Opus Design Review"              → T2 (blockedBy: [T1])
TaskCreate: "GATE 2: Claude Implementation (TDD)"     → T3 (blockedBy: [T2])
TaskCreate: "GATE 3: Static Analysis"                 → T4 (blockedBy: [T3])
TaskCreate: "GATE 4: Gas/Performance"                 → T5 (blockedBy: [T4])
TaskCreate: "FINAL: Code Review - Sonnet"             → T6 (blockedBy: [T5])
TaskCreate: "FINAL: Code Review - Opus"               → T7 (blockedBy: [T6])
TaskCreate: "FINAL: Code Review - Codex"              → T8 (blockedBy: [T7])
```

Save to `.task/pipeline-tasks.json`:
```json
{
  "gate_0_codex_design": "T1-id",
  "gate_1_opus_review": "T2-id",
  "gate_2_implementation": "T3-id",
  "gate_3_static_analysis": "T4-id",
  "gate_4_gas_perf": "T5-id",
  "final_review_sonnet": "T6-id",
  "final_review_opus": "T7-id",
  "final_review_codex": "T8-id"
}
```

---

## Gate Specifications

### GATE 0: Codex Design/Strategy

**Agent:** `codex-designer` (external - Codex CLI)
**Purpose:** Codex leads by producing comprehensive design artifacts with explicit invariants.

**Output Artifacts:**

1. **`docs/security/threat-model.md`**
   - Assets at risk (with max values)
   - Trust assumptions (roles, powers, constraints)
   - Attacker classes (external, insider, MEV, oracle)
   - Attack surfaces (entry points, callbacks)
   - **Enumerated invariants I1..In** (numbered: IC-1, IS-1, IA-1, IT-1, IB-1...)
   - State machine / allowed transitions
   - **Explicit acceptance criteria** (AC-SEC-*, AC-FUNC-*)

2. **`docs/architecture/design.md`**
   - Module boundaries (contracts, libraries, interfaces)
   - External call policy (allowed calls, reentrancy guards)
   - Error/event model (custom errors, events)
   - Storage layout rules (slot assignments, packing, gaps)
   - Call graph / surface area minimization checklist
   - Upgrade strategy (if applicable)

3. **`docs/testing/test-plan.md`**
   - **Mapping table: invariant Ix → tests Tx** (unit/fuzz/invariant/integration)
   - Attack simulations list:
     - Reentrancy with token callbacks
     - Fee-on-transfer / rebasing tokens
     - Sandwich attack boundaries
     - Oracle stale/manipulation
     - DoS / gas griefing
     - Flash loan attacks
   - Coverage targets per module

**Artifact:** `.task/codex-design.json`

**Block condition:** Hook fails if:
- Any artifact file missing
- No invariants section (no IC-*, IS-*, IA-*, IT-*, IB-*)
- No acceptance criteria section
- Any invariant lacks a mapped test entry in test-plan.md

---

### GATE 1: Opus Design Review

**Agent:** `opus-design-reviewer` (opus)
**Purpose:** Independently review Codex's design for architectural flaws, security gaps, missing invariants.

**Process:**
1. Read all GATE 0 artifacts
2. Review for:
   - Architectural flaws or anti-patterns
   - Security gaps or missing attack vectors
   - Missing or weak invariants
   - Ambiguous acceptance criteria
   - Gas/perf footguns in design
   - Storage layout issues
   - External call risks

**Output:** `docs/reviews/design-review-opus.md`

```markdown
# Design Review: Opus

## Summary
[Overall assessment]

## Approval Status: APPROVED | NEEDS_CHANGES | NEEDS_CLARIFICATION

## Required Changes (if NEEDS_CHANGES)
| ID | Category | Issue | Required Fix |
|----|----------|-------|--------------|
| DR-1 | Security | Missing reentrancy guard on X | Add nonReentrant to function Y |

## Missing Invariants
- [ ] Should add IC-X for [condition]
- [ ] Should add IA-X for [access control]

## Missing Attack Simulations
- [ ] Flash loan + oracle manipulation not covered

## Clarification Questions (if NEEDS_CLARIFICATION)
1. [Question about design decision]

## Architecture Assessment
[Detailed review of module boundaries, storage, external calls]

## Security Assessment
[Detailed review of attack surfaces, trust assumptions]
```

**Artifact:** `.task/design-review-opus.json`

```json
{
  "status": "APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION",
  "required_changes": [...],
  "missing_invariants": [...],
  "missing_attack_simulations": [...],
  "clarification_questions": [...],
  "reviewed_at": "ISO8601"
}
```

**Block condition:**
- If `NEEDS_CHANGES` or `NEEDS_CLARIFICATION`:
  - Create fix task for Codex to update design docs
  - Create re-review task (same gate) blocked by fix task
  - Loop until `APPROVED`

---

### GATE 2: Claude Implementation with TDD

**Agent:** `sc-implementer` (sonnet)
**Purpose:** Implement the approved design using TDD with Foundry.

**Process:**
1. Read approved design artifacts (threat-model, design, test-plan)
2. Write invariant tests FIRST
3. Write unit tests
4. Implement minimal code to pass
5. Run fuzz tests
6. Run invariant tests (if enabled)
7. Save all outputs to reports/

**Output Artifacts:**
- Source code in `src/`
- Tests in `test/`
- `reports/forge-test.log` - forge test output
- `reports/invariant-test.log` - invariant test output (if enabled)
- `.task/impl-result.json`

**Block condition:** Hook fails if:
- `forge test` fails (exit code != 0)
- Invariant tests fail (if `enable_invariants=true`)
- `reports/forge-test.log` missing
- Tests referenced in test-plan.md don't exist (basic validation)

---

### GATE 3: Static Analysis

**Agent:** `security-auditor` (opus)
**Purpose:** Run static analyzers, interpret findings, manage suppressions.

**Process:**
1. Run Slither: `slither . --json reports/slither.json`
2. Run Semgrep (if enabled): `semgrep --config auto --json -o reports/semgrep.json`
3. Categorize findings by severity
4. For High severity: fix or add justified suppression

**Output Artifacts:**
- `reports/slither.json`
- `reports/semgrep.json` (if enabled)
- `docs/security/suppressions.md` (for justified suppressions)
- `.task/static-analysis.json`

**Suppression format:**
```markdown
### SUPP-001: [Rule ID]
- **Tool:** Slither
- **Rule:** reentrancy-eth
- **Severity:** High
- **Location:** src/Vault.sol:deposit()
- **Justification:** [Why safe - e.g., nonReentrant modifier present]
- **Evidence:** test/attack/ReentrancyAttack.t.sol
```

**Block condition:** Hook fails if:
- `reports/slither.json` missing (when Slither enabled)
- High severity findings without suppression justification

---

### GATE 4: Gas/Performance Pass

**Agent:** `perf-optimizer` (sonnet)
**Purpose:** Optimize gas with strict evidence requirements.

**Process:**
1. Capture baseline: `forge snapshot --snap reports/.gas-snapshot-before`
2. Apply optimizations
3. **If logic changed:** Rerun ALL tests and invariants
4. Capture after: `forge snapshot --snap reports/.gas-snapshot-after`
5. Generate diff and documentation

**Output Artifacts:**
- `reports/.gas-snapshot-before`
- `reports/.gas-snapshot-after`
- `reports/gas-snapshots.md` (summary with deltas)
- `docs/performance/perf-report.md` (detailed analysis)
- `.task/perf-result.json`

**Block condition:** Hook fails if:
- No before/after evidence
- Logic changed without test/invariant rerun evidence
- Tests failed after optimization

---

### FINAL GATE: Multi-Review (Sonnet → Opus → Codex)

**Review Order Enforced:**
1. **Sonnet** - Quick bugs/style/obvious security
2. **Opus** - Deep edge cases, architecture drift vs design docs
3. **Codex** - Final judgment (must approve)

**Agent:** `sc-code-reviewer` (sonnet, opus), `codex-reviewer` (external)

**Review Prompts Must Require:**
1. Exploit paths (if any) + severity + reproduction steps
2. Invariant coverage audit (design invariants vs tests vs code)
3. Storage/upgrade audit
4. Economic/MEV attack audit
5. Gas regression check

**Output:** `.task/code-review-{sonnet,opus,codex}.json`

**Codex Must Output Exactly One Of:**
- `APPROVED` - Pipeline completes
- `NEEDS_CHANGES` - Create fix task, re-review
- `NEEDS_CLARIFICATION` - Provide clarification, re-review

**Block condition:**
- Pipeline NOT complete unless Codex outputs `APPROVED`
- All previous gates must be green

---

## Main Loop

```
while pipeline not complete:
    1. TaskList() → find task where blockedBy empty AND status pending
    2. TaskUpdate(task_id, status: "in_progress")
    3. Execute task using appropriate agent (Task tool)
    4. Gate validator checks artifacts
    5. If gate fails OR review returns NEEDS_*:
       - Create fix task
       - Create re-run task (blocked by fix)
       - Update next task's blockedBy
    6. If gate passes AND review APPROVED:
       - TaskUpdate(task_id, status: "completed")
    7. Continue to next gate
```

### Loop-Back Handling

**GATE 1 (Opus Design Review) returns NEEDS_CHANGES:**
```
Create: T1.1 "Fix Design - Codex v1" (blockedBy: [T2])
  → Codex updates docs based on Opus feedback
Create: T1.2 "Opus Design Review v2" (blockedBy: [T1.1])
Update: T3 addBlockedBy: [T1.2]
```

**FINAL GATE (Any reviewer) returns NEEDS_CHANGES:**
```
Create: T8.1 "Fix Code - v1" (blockedBy: [T8])
Create: T8.2 "Re-review - Same Reviewer v2" (blockedBy: [T8.1])
Update: Next reviewer addBlockedBy: [T8.2]
```

---

## Agent Reference

| Gate | Task | Agent | Model | Output |
|------|------|-------|-------|--------|
| 0 | Codex Design | codex-designer | external | threat-model, design, test-plan |
| 1 | Opus Review | opus-design-reviewer | opus | design-review-opus.md |
| 2 | Implementation | sc-implementer | sonnet | impl-result.json |
| 3 | Static Analysis | security-auditor | opus | slither.json |
| 4 | Gas/Perf | perf-optimizer | sonnet | perf-report.md |
| Final | Review - Sonnet | sc-code-reviewer | sonnet | code-review-sonnet.json |
| Final | Review - Opus | sc-code-reviewer | opus | code-review-opus.json |
| Final | Review - Codex | codex-reviewer | external | code-review-codex.json |

### Spawning Workers

```
# For Codex (external)
Task(
  subagent_type: "claude-codex:codex-designer",
  prompt: "[Design instructions + user requirements]"
)

# For Claude/Opus
Task(
  subagent_type: "claude-codex:<agent-name>",
  model: "<sonnet|opus>",
  prompt: "[Instructions + context]"
)
```

---

## Configuration Reference

`.claude-codex.json` in project root:

```json
{
  "smart_contract_secure": {
    "enable_invariants": true,
    "enable_slither": true,
    "enable_semgrep": false,
    "fuzz_runs": 5000,
    "gate_strictness": "high",
    "required_coverage": 80,
    "max_iterations": 10,
    "foundry_profile": "default"
  }
}
```

---

## Terminal States

| State | Meaning | Action |
|-------|---------|--------|
| `complete` | Codex approved, all gates green | Report success |
| `design_rejected` | Opus rejected design after max iterations | Escalate to user |
| `gate_failed` | Gate artifact missing/invalid | Fix and retry |
| `max_iterations` | 10+ fixes on same gate | Escalate to user |
| `code_rejected` | Codex rejected code after max iterations | Escalate to user |

---

## Important Rules

1. **Codex leads design** - GATE 0 produces all strategy artifacts
2. **Opus validates design** - GATE 1 catches what Codex missed
3. **Claude implements** - GATE 2 is TDD with Foundry
4. **Evidence required** - No "trust me" outputs
5. **Same-reviewer re-review** - Fixes validated by same agent
6. **Codex is final gate** - Pipeline NOT complete without Codex APPROVED
7. **Max 10 iterations** - Per gate, then escalate
8. **Loop-back is normal** - Design review can send back to Codex

---

## How to Run

```bash
# Start the pipeline
/claude-codex:smart-contract-secure <task description>

# Example
/claude-codex:smart-contract-secure "Implement a secure ERC-4626 vault with flash loan protection"
```

**Required tools:**
- Foundry (forge, cast)
- Slither (recommended)
- Codex CLI (required for GATE 0 and FINAL)
- Semgrep (optional)

---

## How to Extend

### Adding a New Gate

1. Create agent in `agents/`
2. Add task to pipeline initialization (with correct blockedBy)
3. Define required artifacts
4. Update gate-validator.js with validation rules
5. Update this SKILL.md documentation

### Modifying Loop Behavior

Edit max iterations in `.claude-codex.json`:
```json
{
  "smart_contract_secure": {
    "max_iterations": 5
  }
}
```

---

## Emergency Controls

If stuck:

1. **Check task state:** `TaskList()` to see blocked tasks
2. **Check artifacts:** Read `docs/` and `reports/` directories
3. **Reset pipeline:** `"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset`
4. **Manual override:** Set `gate_strictness: "low"` (not recommended for production)
