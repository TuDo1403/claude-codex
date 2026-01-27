---
name: smart-contract-secure
description: Security-first smart contract pipeline with evidence-based gates, TDD enforcement, static analysis, and multi-review final approval. Codex as final gate. For fund-sensitive contracts.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Smart Contract Security Pipeline

You coordinate a **security-first pipeline** for fund-sensitive smart contracts. Every stage produces verifiable artifacts. Gates block progression if acceptance criteria aren't met.

**Task directory:** `${CLAUDE_PROJECT_DIR}/.task/`
**Reports directory:** `${CLAUDE_PROJECT_DIR}/reports/`
**Docs directory:** `${CLAUDE_PROJECT_DIR}/docs/`
**Agents location:** `${CLAUDE_PLUGIN_ROOT}/agents/`
**Templates location:** `${CLAUDE_PLUGIN_ROOT}/templates/`

---

## Non-Negotiable Principles

1. **Security is a hard constraint** - Gas/perf optimization only AFTER correctness + invariants proven
2. **Evidence-based gates** - Every stage produces verifiable artifacts (files, test outputs, reports)
3. **Enforceable pipeline** - Tasks cannot be skipped; hooks block if criteria not met
4. **Evidence-based approval** - All decisions based on CI outputs, invariant results, slither results, gas snapshots
5. **Adaptable but strict** - Optional tools can be toggled, but strong defaults remain

---

## Architecture: Gate-Enforced Pipeline

```
GATE 0 (Spec/Threat Model)
    ↓ docs/security/threat-model.md
GATE 1 (Architecture + Storage)
    ↓ docs/architecture/design.md
GATE 2 (Test Plan)
    ↓ docs/testing/test-plan.md
GATE 3 (Implementation TDD)
    ↓ Source code + reports/forge-test.log
GATE 4 (Static Analysis)
    ↓ reports/slither.json + docs/security/suppressions.md
GATE 5 (Gas/Performance)
    ↓ reports/gas-snapshots.md + docs/performance/perf-report.md
FINAL GATE (Multi-Review)
    ↓ Sonnet → Opus → Codex (APPROVED required)
```

| Component | Role |
|-----------|------|
| **Tasks** (primary) | Structural enforcement via `blockedBy`, audit trail |
| **Gate Validator Hook** | Validates artifacts exist and meet schema before proceeding |
| **SubagentStop Hook** | Validates reviewer outputs, blocks if incomplete |
| **Main Thread** | Orchestrates gates, handles user input, creates fix tasks |

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
mkdir -p docs/security docs/architecture docs/testing docs/performance reports
```

### Step 3: Copy Templates (if not exist)

Copy from `${CLAUDE_PLUGIN_ROOT}/templates/` to project:
- `threat-model.template.md` → `docs/security/threat-model.md`
- `design.template.md` → `docs/architecture/design.md`
- `test-plan.template.md` → `docs/testing/test-plan.md`
- `perf-report.template.md` → `docs/performance/perf-report.md`

### Step 4: Create Task Chain with Dependencies

```
TaskCreate: "GATE 0: Threat Model & Invariants"       → T1 (blockedBy: [])
TaskCreate: "GATE 1: Architecture & Storage Design"   → T2 (blockedBy: [T1])
TaskCreate: "GATE 2: Test Plan Mapping"               → T3 (blockedBy: [T2])
TaskCreate: "GATE 3: Implementation with TDD"         → T4 (blockedBy: [T3])
TaskCreate: "GATE 4: Static Analysis"                 → T5 (blockedBy: [T4])
TaskCreate: "GATE 5: Gas/Performance Pass"            → T6 (blockedBy: [T5])
TaskCreate: "FINAL: Code Review - Sonnet"             → T7 (blockedBy: [T6])
TaskCreate: "FINAL: Code Review - Opus"               → T8 (blockedBy: [T7])
TaskCreate: "FINAL: Code Review - Codex"              → T9 (blockedBy: [T8])
```

Save to `.task/pipeline-tasks.json`:
```json
{
  "gate_0_threat_model": "T1-id",
  "gate_1_architecture": "T2-id",
  "gate_2_test_plan": "T3-id",
  "gate_3_implementation": "T4-id",
  "gate_4_static_analysis": "T5-id",
  "gate_5_gas_perf": "T6-id",
  "final_review_sonnet": "T7-id",
  "final_review_opus": "T8-id",
  "final_review_codex": "T9-id"
}
```

---

## Gate Specifications

### GATE 0: Spec/Threat Model

**Agent:** `threat-modeler` (opus)
**Output:** `docs/security/threat-model.md`
**Artifact:** `.task/threat-model.json`

**Required sections:**
- Assets (what's at risk)
- Trust assumptions (roles, powers, external deps)
- Attacker classes (insider, external, MEV, oracle)
- Attack surfaces (entry points, callbacks, external calls)
- Enumerated invariants (I1..In with formal descriptions)
- State machine / allowed transitions
- Acceptance criteria (explicit, measurable)

**Block condition:** Hook fails if:
- `docs/security/threat-model.md` missing
- No invariants section (no `## Invariants` with I1, I2, etc.)
- No acceptance criteria section

---

### GATE 1: Architecture + Storage

**Agent:** `architect` (opus)
**Output:** `docs/architecture/design.md`
**Artifact:** `.task/architecture.json`

**Required sections:**
- Module boundaries (contracts, libraries, interfaces)
- External call policy (what calls are allowed, reentrancy guards)
- Error/event model (custom errors, events for monitoring)
- Storage layout rules (packing, upgradeable constraints, gaps)
- Call graph / surface area minimization checklist
- Upgrade strategy (if applicable)

**Block condition:** Hook fails if:
- `docs/architecture/design.md` missing
- No `## Storage Layout` section
- No `## External Call Policy` section

---

### GATE 2: Test Plan Mapping

**Agent:** `test-planner` (opus or sonnet)
**Output:** `docs/testing/test-plan.md`
**Artifact:** `.task/test-plan.json`

**Required sections:**
- Mapping table: invariant Ix → tests Tx (unit/fuzz/invariant/integration)
- Attack simulations list:
  - Reentrancy with token callbacks
  - Fee-on-transfer / rebasing tokens
  - Sandwich attack boundaries
  - Oracle stale/manipulation
  - DoS / gas griefing
- Coverage targets per module

**Block condition:** Hook fails if:
- `docs/testing/test-plan.md` missing
- Any invariant from GATE 0 has no mapped test entry
- No attack simulations section

---

### GATE 3: Implementation with TDD

**Agent:** `sc-implementer` (sonnet)
**Output:** Source code, Foundry tests
**Artifacts:**
- `.task/impl-result.json`
- `reports/forge-test.log`
- `reports/invariant-test.log` (if enabled)

**TDD Cycle:**
1. Write invariant test first
2. Write unit test
3. Implement minimal code to pass
4. Run `forge test` - must pass
5. Run `forge test --fuzz-runs <config>` for fuzz tests
6. Run invariant tests if `enable_invariants=true`
7. Save all outputs to reports/

**Block condition:** Hook fails if:
- `forge test` fails (exit code != 0)
- Invariant tests fail (if enabled)
- `reports/forge-test.log` missing

---

### GATE 4: Static Analysis

**Agent:** `security-auditor` (opus)
**Output:**
- `reports/slither.json` or `reports/slither.md`
- `reports/semgrep.json` (if enabled)
- `docs/security/suppressions.md` (for justified suppressions)
**Artifact:** `.task/static-analysis.json`

**Process:**
1. Run `slither . --json reports/slither.json` (if enabled)
2. Run `semgrep --config auto --json -o reports/semgrep.json` (if enabled)
3. Analyze findings, categorize by severity
4. For High severity: must either fix or add justified suppression

**Suppression format** (`docs/security/suppressions.md`):
```markdown
## Suppressed Findings

### SUPP-001: [Finding Title]
- **Tool:** Slither
- **Severity:** High
- **Finding:** [description]
- **Justification:** [why this is safe / false positive]
- **Evidence:** [link to tests, invariants, or formal proof]
- **Approved by:** [name/date]
```

**Block condition:** Hook fails if:
- `reports/slither.json` missing (when `enable_slither=true`)
- High severity findings without suppression justification in `docs/security/suppressions.md`

---

### GATE 5: Gas/Performance Pass

**Agent:** `perf-optimizer` (sonnet)
**Output:**
- `reports/gas-snapshots.md` (from `forge snapshot`)
- `docs/performance/perf-report.md`
**Artifact:** `.task/perf-result.json`

**Process:**
1. Run `forge snapshot --snap reports/.gas-snapshot-before` (baseline)
2. Apply optimizations
3. Run `forge snapshot --snap reports/.gas-snapshot-after`
4. Run `forge snapshot --diff reports/.gas-snapshot-before`
5. Generate `reports/gas-snapshots.md` with before/after comparison
6. **CRITICAL:** If logic modified, rerun ALL tests and invariants
7. Document in `docs/performance/perf-report.md`

**Perf report sections:**
- Baseline measurements
- Optimizations applied
- After measurements
- Delta summary (gas saved per function)
- Invariant re-verification status
- Test re-run results

**Block condition:** Hook fails if:
- `reports/gas-snapshots.md` missing
- No before/after evidence
- Logic modified without test/invariant rerun evidence

---

### FINAL GATE: Multi-Review (Sonnet → Opus → Codex)

**Agents:** `sc-code-reviewer` (sonnet, opus), `codex-reviewer` (external)
**Output:** `.task/code-review-{sonnet,opus,codex}.json`

**Review prompts MUST require:**
1. Exploit paths (if any) + severity + reproduction steps
2. Invariant coverage audit (are all I1..In tested?)
3. Storage/upgrade audit (gaps, collision risks)
4. Economic/MEV attack audit (sandwich, oracle manipulation)
5. Gas regression check (compare to baseline)

**Reviewer order enforced via blockedBy:**
- Sonnet first (quick check)
- Opus second (deep analysis)
- Codex final (independent gate)

**Codex output MUST be one of:**
- `APPROVED` - Pipeline completes
- `NEEDS_CHANGES` - Create fix task, re-review
- `NEEDS_CLARIFICATION` - Provide clarification, re-review

**Block condition:**
- Pipeline NOT complete unless Codex outputs `APPROVED`
- All gates must be green (artifacts validated)

---

## Main Loop

```
while pipeline not complete:
    1. TaskList() → find task where blockedBy empty AND status pending
    2. TaskUpdate(task_id, status: "in_progress")
    3. Execute task using appropriate agent (Task tool)
    4. Gate validator checks artifacts
    5. If gate fails → create fix task, loop
    6. If gate passes → TaskUpdate(task_id, status: "completed")
    7. Continue to next gate
```

### Result Handling

**Gate failures:**
| Gate | Failure | Action |
|------|---------|--------|
| 0-5 | Missing artifact | Create fix task, re-run same gate |
| 0-5 | Validation fails | Create fix task, re-run same gate |
| Final | `needs_changes` | Create fix task, re-review SAME reviewer |
| Final | `rejected` | Escalate to user |
| Final | Codex `APPROVED` | Pipeline complete |

---

## Agent Reference

| Gate | Task | Agent | Model | Output |
|------|------|-------|-------|--------|
| 0 | Threat Model | threat-modeler | opus | threat-model.md |
| 1 | Architecture | architect | opus | design.md |
| 2 | Test Plan | test-planner | opus/sonnet | test-plan.md |
| 3 | Implementation | sc-implementer | sonnet | impl-result.json |
| 4 | Static Analysis | security-auditor | opus | slither.json |
| 5 | Gas/Perf | perf-optimizer | sonnet | perf-report.md |
| Final | Review - Sonnet | sc-code-reviewer | sonnet | code-review-sonnet.json |
| Final | Review - Opus | sc-code-reviewer | opus | code-review-opus.json |
| Final | Review - Codex | codex-reviewer | external | code-review-codex.json |

### Spawning Workers

```
Task(
  subagent_type: "claude-codex:<agent-name>",
  model: "<model>",
  prompt: "[Agent instructions] + [Context from artifacts]"
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

| Setting | Default | Description |
|---------|---------|-------------|
| `enable_invariants` | true | Run invariant tests in Gate 3 |
| `enable_slither` | true | Run Slither in Gate 4 |
| `enable_semgrep` | false | Run Semgrep in Gate 4 |
| `fuzz_runs` | 5000 | Foundry fuzz run count |
| `gate_strictness` | high | `high` = all gates enforced, `medium` = warnings only |
| `required_coverage` | 80 | Minimum test coverage % |
| `max_iterations` | 10 | Max fix iterations per gate |
| `foundry_profile` | default | Foundry profile to use |

---

## Terminal States

| State | Meaning | Action |
|-------|---------|--------|
| `complete` | Codex approved, all gates green | Report success |
| `gate_failed` | Gate artifact missing/invalid | Fix and retry |
| `max_iterations` | 10+ fixes on same gate | Escalate to user |
| `rejected` | Codex rejected | User decision needed |

---

## Important Rules

1. **Gates are sequential** - Cannot skip; blockedBy enforces
2. **Artifacts are mandatory** - Hook validates existence and schema
3. **Security before optimization** - Gate 5 comes AFTER Gates 3-4
4. **Evidence required** - No "trust me" outputs; CI logs, reports saved
5. **Same-reviewer re-review** - Fixes validated by same agent
6. **Codex is mandatory** - Pipeline NOT complete without Codex APPROVED
7. **Max 10 iterations** - Per gate, then escalate
8. **Configuration adaptable** - But strong defaults remain

---

## How to Run

```bash
# Start the pipeline
/claude-codex:smart-contract-secure <task description>

# Example
/claude-codex:smart-contract-secure "Implement a secure ERC-4626 vault with flash loan protection"
```

**Required local tools:**
- Foundry (forge, cast)
- Slither (optional but recommended)
- Semgrep (optional)

---

## How to Extend

### Adding a New Analyzer (e.g., Mythril)

1. Add to config: `"enable_mythril": false`
2. Add to Gate 4 agent instructions
3. Add artifact: `reports/mythril.json`
4. Update gate-validator.js to check artifact

### Adding a New Gate

1. Create new agent in `agents/`
2. Add task to pipeline initialization (with correct blockedBy)
3. Define required artifacts
4. Update gate-validator.js with validation rules

### Modifying Strictness

Edit `.claude-codex.json`:
- `"gate_strictness": "medium"` - Warnings instead of blocks
- `"enable_slither": false` - Skip static analysis
- `"fuzz_runs": 1000` - Faster but less thorough

---

## Emergency Controls

If stuck:

1. **Check task state:** `TaskList()` to see blocked tasks
2. **Check artifacts:** Read `docs/` and `reports/` directories
3. **Check gate validation:** Read `.task/*.json` for validation results
4. **Reset pipeline:** `"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset`
5. **Manual override:** Set `gate_strictness: "low"` (not recommended for production)
