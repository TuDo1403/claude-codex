---
name: smart-contract-secure
description: Security-first smart contract pipeline. Codex leads design/strategy, Claude implements with TDD, Opus reviews architecture, Codex final approval. For fund-sensitive contracts.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList, TaskGet, mcp__slither-mcp__*, mcp__serena__*
---

# Smart Contract Security Pipeline

You coordinate a **security-first pipeline** for fund-sensitive smart contracts with **Codex as design lead and final approver**.

**Role Order:**
1. **Codex** = Requirements gathering (user story, acceptance criteria)
2. **Codex** = Design/Strategy lead (threat model, architecture, test plan)
3. **Opus** = Design review (architecture/security validation)
4. **Claude (Sonnet)** = Implementation with TDD
5. **Static Analysis** = Slither/Semgrep
6. **Gas/Performance** = Optimization with evidence
7. **Final Gate** = Sonnet → Opus → **Codex** (must approve)

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
6. **Coverage before polish** - Prioritize complete vulnerability discovery before patch/exploit polish
7. **Use serena + slither-mcp for ALL code operations** - Prefer serena symbolic tools over raw Read/Edit for code navigation and editing. Use slither-mcp for ALL security analysis. See Hard Rule below.

---

## Hard Rule: serena + slither-mcp Usage (MANDATORY)

> **For Solidity projects, you MUST use serena MCP and slither-mcp MCP tools throughout the pipeline. Raw Read/Edit/Grep are fallbacks only.**

### serena MCP Tools (code navigation + editing)
- `mcp__serena__check_onboarding_performed` / `mcp__serena__onboarding` / `mcp__serena__initial_instructions` — Initialize at pipeline start
- `mcp__serena__get_symbols_overview` — Understand file structure before editing
- `mcp__serena__find_symbol` — Find classes, functions, variables by name pattern
- `mcp__serena__find_referencing_symbols` — Find all references to a symbol (impact analysis)
- `mcp__serena__replace_symbol_body` — Replace function/contract bodies (PREFERRED over Edit)
- `mcp__serena__insert_after_symbol` / `mcp__serena__insert_before_symbol` — Add new code at precise locations
- `mcp__serena__rename_symbol` — Rename across entire codebase
- `mcp__serena__search_for_pattern` — Regex search with context
- `mcp__serena__list_memories` / `mcp__serena__read_memory` / `mcp__serena__write_memory` — Persist knowledge across sessions

### slither-mcp Tools (security analysis + contract inspection)
- `mcp__slither-mcp__get_project_overview` — Project-wide stats
- `mcp__slither-mcp__list_contracts` / `mcp__slither-mcp__search_contracts` — Discover contracts
- `mcp__slither-mcp__get_contract` / `mcp__slither-mcp__get_contract_source` — Contract metadata + source
- `mcp__slither-mcp__list_functions` / `mcp__slither-mcp__search_functions` — Function discovery
- `mcp__slither-mcp__get_function_source` — Read function implementation
- `mcp__slither-mcp__get_function_callees` / `mcp__slither-mcp__get_function_callers` — Call graph
- `mcp__slither-mcp__get_inherited_contracts` / `mcp__slither-mcp__get_derived_contracts` — Inheritance
- `mcp__slither-mcp__get_storage_layout` — Storage slot analysis
- `mcp__slither-mcp__run_detectors` — Security detectors (filter by severity/confidence)
- `mcp__slither-mcp__analyze_modifiers` — Access control patterns
- `mcp__slither-mcp__analyze_low_level_calls` — call/delegatecall/staticcall/assembly
- `mcp__slither-mcp__analyze_state_variables` — State variable audit
- `mcp__slither-mcp__analyze_events` — Event definitions
- `mcp__slither-mcp__get_contract_dependencies` — Dependency map + circular detection
- `mcp__slither-mcp__export_call_graph` — Visual call graph (Mermaid/DOT)
- `mcp__slither-mcp__find_dead_code` — Dead code detection

---

## Pipeline Architecture

```
[serena onboarding + slither-mcp project scan]
    ↓
REQUIREMENTS: Codex Requirements Gathering
    ↓ user-story.json (acceptance criteria, scope)
GATE 0: Codex Design/Strategy
    ↓ threat-model.md, design.md, test-plan.md
GATE 1: Opus Design Review
    ↓ design-review-opus.md (APPROVED required, loops back if NEEDS_CHANGES)
GATE 2: Claude Implementation (TDD) [serena symbolic ops + slither-mcp checks]
    ↓ Source code + reports/forge-test.log
GATE 3: Static Analysis [slither-mcp deep analysis + CLI]
    ↓ reports/slither.json + slither-mcp-analysis.md + suppressions.md
GATE 4: Gas/Performance
    ↓ reports/gas-snapshots.md + perf-report.md
CALIBRATION LOOP: Detect [slither-mcp] → Patch [serena] → Exploit
    ↓ detect-findings.md + patch-validation.md + exploit-validation.md
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

### Step 0: serena Onboarding + slither-mcp Project Scan

**Before any pipeline work begins:**
1. Call `mcp__serena__check_onboarding_performed()` → if not done, call `mcp__serena__onboarding()` + `mcp__serena__initial_instructions()`
2. Call `mcp__serena__list_memories()` → read any relevant project memories
3. Call `mcp__slither-mcp__get_project_overview(path: ".")` → get contract counts, function counts, finding distribution
4. Call `mcp__slither-mcp__list_contracts(path: ".", exclude_paths: ["lib/", "test/", "node_modules/"])` → discover in-scope contracts
5. Save serena + slither context for all downstream stages

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
TaskCreate: "REQUIREMENTS: Codex Requirements"        → T0 (blockedBy: [])
TaskCreate: "GATE 0: Codex Design/Strategy"           → T1 (blockedBy: [T0])
TaskCreate: "GATE 1: Opus Design Review"              → T2 (blockedBy: [T1])
TaskCreate: "GATE 2: Claude Implementation (TDD)"     → T3 (blockedBy: [T2])
TaskCreate: "GATE 3: Static Analysis"                 → T4 (blockedBy: [T3])
TaskCreate: "GATE 4: Gas/Performance"                 → T5 (blockedBy: [T4])
TaskCreate: "CALIBRATION: Detect Coverage Sprint"     → T5a (blockedBy: [T5])
TaskCreate: "CALIBRATION: Patch Closure Sprint"       → T5b (blockedBy: [T5a])
TaskCreate: "CALIBRATION: Exploit Replay Sprint"      → T5c (blockedBy: [T5b])
TaskCreate: "FINAL: Code Review - Sonnet"             → T6 (blockedBy: [T5c])
TaskCreate: "FINAL: Code Review - Opus"               → T7 (blockedBy: [T6])
TaskCreate: "FINAL: Code Review - Codex"              → T8 (blockedBy: [T7])
```

Save to `.task/pipeline-tasks.json`:
```json
{
  "requirements_codex": "T0-id",
  "gate_0_codex_design": "T1-id",
  "gate_1_opus_review": "T2-id",
  "gate_2_implementation": "T3-id",
  "gate_3_static_analysis": "T4-id",
  "gate_4_gas_perf": "T5-id",
  "calibration_detect": "T5a-id",
  "calibration_patch": "T5b-id",
  "calibration_exploit": "T5c-id",
  "final_review_sonnet": "T6-id",
  "final_review_opus": "T7-id",
  "final_review_codex": "T8-id"
}
```

---

## Gate Specifications

### REQUIREMENTS: Codex Requirements Gathering

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

**Block condition:** Hook fails if:
- `user-story.json` missing
- No acceptance criteria defined
- No functional requirements
- Scope not bounded

---

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

**Code Writing with serena + slither (REQUIRED):**

Before writing code:
- `mcp__serena__get_symbols_overview(relative_path: "src/")` — understand existing structure
- `mcp__serena__find_symbol(name_path_pattern: "...", include_body: true)` — read existing implementations

When writing code, prefer serena symbolic operations:
- `mcp__serena__replace_symbol_body(name_path, relative_path, body)` — update functions/contracts
- `mcp__serena__insert_after_symbol(name_path, relative_path, body)` — add new functions/modifiers
- `mcp__serena__insert_before_symbol(name_path, relative_path, body)` — add imports/interfaces
- `mcp__serena__rename_symbol(name_path, relative_path, new_name)` — rename across codebase

After implementation, run slither-mcp checks:
- `mcp__slither-mcp__run_detectors(path: ".", exclude_paths: ["lib/", "test/"])` — security scan
- `mcp__slither-mcp__get_storage_layout(path: ".", contract_key: ...)` — verify storage layout matches design
- `mcp__slither-mcp__analyze_modifiers(path: ".")` — verify access control patterns

**Process:**
1. Read approved design artifacts (threat-model, design, test-plan)
2. Use serena to understand existing codebase structure
3. Write invariant tests FIRST (using serena symbolic ops)
4. Write unit tests
5. Implement minimal code to pass (using serena symbolic ops)
6. Run fuzz tests
7. Run invariant tests (if enabled)
8. Run slither-mcp post-implementation security check
9. Save all outputs to reports/

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

**Process (use slither-mcp alongside CLI):**
1. Run Slither CLI: `slither . --json reports/slither.json`
2. Run slither-mcp deep analysis:
   - `mcp__slither-mcp__run_detectors(path: ".", exclude_paths: ["lib/", "test/", "node_modules/"])` — full security scan
   - `mcp__slither-mcp__analyze_low_level_calls(path: ".")` — find call/delegatecall/assembly
   - `mcp__slither-mcp__get_contract_dependencies(path: ".", detect_circular: true)` — dependency map
   - `mcp__slither-mcp__export_call_graph(path: ".", format: "mermaid")` — visual call graph
   - `mcp__slither-mcp__analyze_modifiers(path: ".")` — access control patterns
   - `mcp__slither-mcp__analyze_state_variables(path: ".")` — state variable audit
   - `mcp__slither-mcp__get_storage_layout(path: ".", contract_key: ...)` — storage layout per contract
   - `mcp__slither-mcp__find_dead_code(path: ".", exclude_paths: ["lib/", "test/"])` — dead code
3. Run Semgrep (if enabled): `semgrep --config auto --json -o reports/semgrep.json`
4. Categorize findings by severity (merge CLI + MCP results)
5. For High severity: fix (using serena `replace_symbol_body`) or add justified suppression

> **HARD RULE**: HIGH impact findings from slither-mcp that are NOT in the baseline (pre-existing) MUST be fixed before proceeding.

**Output Artifacts:**
- `reports/slither.json`
- `reports/slither-mcp-analysis.md` (slither-mcp deep analysis)
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

### CALIBRATION LOOP: EVMbench-Aligned Detect → Patch → Exploit

**Purpose:** Improve real end-to-end success by attacking the main bottleneck from EVMbench: vulnerability discovery coverage.

**Task A: Detect Coverage Sprint (`calibration_detect`)**

**Agent:** `exploit-hunter` (opus) or automated via `run-detect-pipeline.js`

**Pre-detection: slither-mcp analysis (REQUIRED)**
- `mcp__slither-mcp__run_detectors(path: ".", impact: ["High", "Medium"], exclude_paths: ["lib/", "test/"])` — seed detection with automated findings
- `mcp__slither-mcp__analyze_low_level_calls(path: ".")` — identify high-risk call sites
- `mcp__slither-mcp__get_contract_dependencies(path: ".", detect_circular: true)` — cross-contract risks
- Feed slither-mcp results into exploit-hunter prompt

1. Run a focused discovery pass over in-scope files.
2. Write findings incrementally to `docs/reviews/detect-findings.md`.
3. Track each candidate with confidence and exploitability.

**Script invocation:**
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/run-detect-pipeline.js" --run-id <run_id> --codex-timeout 900000
```

**Output Artifacts:**
- `docs/reviews/detect-findings.md`
- `.task/detect-coverage.json`

**Hook enforcement:** `review-validator.js` → `validateDetectCoverage()` blocks if missing/malformed.

`detect-coverage.json` minimum shape:
```json
{
  "status": "complete",
  "high_med_candidates": 0,
  "validated_findings": [{ "id": "V-1", "severity": "HIGH", "file": "src/Vault.sol" }],
  "coverage_notes": "entrypoints and modules reviewed"
}
```

**Task B: Patch Closure Sprint (`calibration_patch`)**

**Agent:** `sc-implementer` (sonnet) for patches, `redteam-verifier` (sonnet) for verification

**Patch implementation with serena + slither (REQUIRED):**
- Use `mcp__serena__find_symbol(name_path_pattern: "...", include_body: true)` to read vulnerable function
- Use `mcp__serena__find_referencing_symbols(...)` to understand impact
- Use `mcp__serena__replace_symbol_body(...)` to apply fix
- Re-run `mcp__slither-mcp__run_detectors(path: ".")` to verify fix resolves the finding

1. Patch each validated High/Med candidate (using serena symbolic ops).
2. Run existing tests and exploit/regression tests.
3. Re-run slither-mcp to confirm finding resolved.
4. Record closure status per issue.

**Script invocation:**
```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-patch-verify.js" --run-id <run_id>
```

**Output Artifacts:**
- `docs/reviews/patch-validation.md`
- `.task/patch-closure.json`

**Hook enforcement:** `review-validator.js` → `validatePatchClosure()` blocks if validated findings lack patches.

`patch-closure.json` minimum shape:
```json
{
  "patches": [
    { "finding_id": "V-1", "status": "patched", "test": "test/Vault.t.sol::test_reentrancy_blocked" }
  ]
}
```

**Task C: Exploit Replay Sprint (`calibration_exploit`)**

**Agent:** `redteam-verifier` (sonnet) or automated via `codex-exploit-verify.js`

1. Attempt exploit reproduction for each patched issue.
2. Replay transactions in a clean local chain/container.
3. Verify patched code blocks exploit path and preserves behavior.
4. Record attacker wallet delta checks to avoid false positives.

**Script invocation:**
```bash
# Foundry test mode
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-exploit-verify.js" --run-id <run_id>
# Live chain mode (Anvil + replay-isolated grading)
bun "${CLAUDE_PLUGIN_ROOT}/scripts/codex-exploit-verify.js" --run-id <run_id> --live-chain
```

**Output Artifacts:**
- `docs/reviews/exploit-validation.md`
- `.task/exploit-replay.json`

**Hook enforcement:** `review-validator.js` → `validateExploitReplay()` blocks if patched findings lack replay evidence.

`exploit-replay.json` minimum shape:
```json
{
  "replays": [
    {
      "finding_id": "V-1",
      "verdict": "EXPLOIT_BLOCKED",
      "pre_balance": "100.0",
      "post_balance": "100.0",
      "grading_mode": "replay-isolated"
    }
  ]
}
```

Required per replay: `finding_id` + `verdict` (or `status`). Missing = hook blocks.

**Hint Escalation Rule (required):**
- If Detect stalls, escalate hints in order:
  1. File-level hint (where to inspect)
  2. Mechanism-level hint (what pattern to test)
  3. Grader-check hint (what exact success/failure is measured)
- Script: `bun "${CLAUDE_PLUGIN_ROOT}/scripts/generate-hints.js" --run-id <run_id> --source opus --target codex`
- Record hint level used in all calibration JSON artifacts.

**Block condition:** `review-validator.js` hooks block if:
- `detect-coverage.json` missing `status: "complete"` or `validated_findings` array
- `patch-closure.json` missing patches for validated findings from detect-coverage
- `exploit-replay.json` missing replays for patched findings, or replays without verdict
- Hint level is not recorded when escalation happened

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
| Req | Requirements | requirements-gatherer-codex | external | user-story.json |
| 0 | Codex Design | codex-designer | external | threat-model, design, test-plan |
| 1 | Opus Review | opus-design-reviewer | opus | design-review-opus.md |
| 2 | Implementation | sc-implementer | sonnet | impl-result.json |
| 3 | Static Analysis | security-auditor | opus | slither.json |
| 4 | Gas/Perf | perf-optimizer | sonnet | perf-report.md |
| Cal-A | Detect Coverage | exploit-hunter | opus | detect-coverage.json |
| Cal-B | Patch Closure | sc-implementer + redteam-verifier | sonnet | patch-closure.json |
| Cal-C | Exploit Replay | redteam-verifier | sonnet | exploit-replay.json |
| Final | Review - Sonnet | sc-code-reviewer | sonnet | code-review-sonnet.json |
| Final | Review - Opus | sc-code-reviewer | opus | code-review-opus.json |
| Final | Review - Codex | codex-reviewer | external | code-review-codex.json |

### Spawning Workers

```
# For Codex Requirements (external)
Task(
  subagent_type: "claude-codex:requirements-gatherer-codex",
  prompt: "[User's task description]"
)

# For Codex Design (external)
Task(
  subagent_type: "claude-codex:codex-designer",
  prompt: "[Design instructions + user requirements from user-story.json]"
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
9. **serena + slither-mcp mandatory** - Use serena for ALL code navigation/editing, slither-mcp for ALL security analysis. Raw Read/Edit/Grep are fallbacks only.

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
- Slither (recommended) + slither-mcp (REQUIRED for deep analysis)
- serena MCP (REQUIRED for code navigation and editing)
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
