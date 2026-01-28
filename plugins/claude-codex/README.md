# Claude Codex Plugin

Multi-AI orchestration pipeline with Task-based enforcement and Codex as final gate.

## Skills

### `/multi-ai` - General Purpose Pipeline

Start the standard multi-AI pipeline for any development task.

```bash
/multi-ai <description of what you want>
```

**Pipeline:**
1. Gather requirements (interactive)
2. Create implementation plan
3. Review plan (Sonnet → Opus → Codex)
4. Implementation
5. Review code (Sonnet → Opus → Codex)
6. Complete

### `/smart-contract-secure` - Fund-Sensitive Smart Contract Pipeline

**Security-first pipeline where Codex leads design, Claude implements, and Codex gives final approval.**

```bash
/claude-codex:smart-contract-secure <task description>
```

**Example:**
```bash
/claude-codex:smart-contract-secure "Implement a secure ERC-4626 vault with flash loan protection"
```

---

## Smart Contract Secure Pipeline

### Role Order (NEW)

1. **Codex** = Design/Strategy lead (produces ALL design artifacts)
2. **Opus** = Design review (catches what Codex missed)
3. **Claude (Sonnet)** = Implementation with TDD
4. **Opus** = Static analysis interpretation
5. **Sonnet** = Gas optimization
6. **Final Gate** = Sonnet → Opus → **Codex** (must approve)

### Gates

| Gate | Name | Agent | Output |
|------|------|-------|--------|
| 0 | **Codex Design** | codex-designer (external) | threat-model, design, test-plan |
| 1 | Opus Design Review | opus-design-reviewer (opus) | `docs/reviews/design-review-opus.md` |
| 2 | Implementation | sc-implementer (sonnet) | Source + `reports/forge-test.log` |
| 3 | Static Analysis | security-auditor (opus) | `reports/slither.json` |
| 4 | Gas/Performance | perf-optimizer (sonnet) | `reports/gas-snapshots.md` |
| Final | Multi-Review | sc-code-reviewer + codex | Sonnet → Opus → **Codex** |

### Non-Negotiable Principles

1. **Security is a hard constraint** - Gas/perf optimization only AFTER correctness + invariants proven
2. **Evidence-based gates** - Every stage produces verifiable artifacts
3. **Enforceable pipeline** - Tasks cannot be skipped; hooks block if criteria not met
4. **Evidence-based approval** - All decisions based on CI outputs, test results, analysis reports

### Required Tools

| Tool | Required | Purpose |
|------|----------|---------|
| Foundry (forge) | Yes | Smart contract testing |
| Slither | Recommended | Static analysis |
| Semgrep | Optional | Additional static analysis |

**Install Foundry:**
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**Install Slither:**
```bash
pip install slither-analyzer
```

### Configuration

Create `.claude-codex.json` in your project root:

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

**Configuration Options:**

| Setting | Default | Description |
|---------|---------|-------------|
| `enable_invariants` | `true` | Run invariant tests in Gate 3 |
| `enable_slither` | `true` | Run Slither in Gate 4 |
| `enable_semgrep` | `false` | Run Semgrep in Gate 4 |
| `fuzz_runs` | `5000` | Foundry fuzz run count |
| `gate_strictness` | `"high"` | `high` = block, `medium` = warn |
| `required_coverage` | `80` | Minimum test coverage % |
| `max_iterations` | `10` | Max fix iterations per gate |

### Artifacts Generated

```
your-project/
├── docs/
│   ├── security/
│   │   ├── threat-model.md      # Gate 0 output
│   │   └── suppressions.md      # Gate 4 suppressions
│   ├── architecture/
│   │   └── design.md            # Gate 1 output
│   ├── testing/
│   │   └── test-plan.md         # Gate 2 output
│   └── performance/
│       └── perf-report.md       # Gate 5 output
├── reports/
│   ├── forge-test.log           # Gate 3 test output
│   ├── invariant-test.log       # Gate 3 invariant output
│   ├── slither.json             # Gate 4 analysis
│   ├── .gas-snapshot-before     # Gate 5 baseline
│   ├── .gas-snapshot-after      # Gate 5 after
│   └── gas-snapshots.md         # Gate 5 summary
└── .task/
    ├── threat-model.json        # Gate 0 artifact
    ├── architecture.json        # Gate 1 artifact
    ├── test-plan.json           # Gate 2 artifact
    ├── impl-result.json         # Gate 3 artifact
    ├── static-analysis.json     # Gate 4 artifact
    ├── perf-result.json         # Gate 5 artifact
    └── code-review-*.json       # Final gate reviews
```

### Gate Blocking Conditions

| Gate | Block If |
|------|----------|
| 0 | Missing threat-model.md, no invariants, no acceptance criteria |
| 1 | Missing design.md, no storage layout, no external call policy |
| 2 | Missing test-plan.md, invariants without mapped tests |
| 3 | `forge test` fails, invariant tests fail, missing logs |
| 4 | Missing slither.json (if enabled), unsuppressed High findings |
| 5 | Missing gas evidence, logic changed without test rerun |
| Final | Codex does not output `APPROVED` |

---

### `/blind-audit-sc` - Blind-Audit Smart Contract Pipeline

**Maximum security with strict blindness enforcement between reviewers.**

```bash
/claude-codex:blind-audit-sc <task description>
```

**Example:**
```bash
/claude-codex:blind-audit-sc "Implement a secure ERC-4626 vault with flash loan protection"
```

**Key Features:**
- **Stage 3 (Spec Compliance)** reviews specs WITHOUT seeing code
- **Stage 4 (Exploit Hunt)** reviews code WITHOUT seeing spec narrative
- **Stage 5 (Red-Team Loop)** iterates until ALL HIGH/MED issues CLOSED
- **Codex writes specs AND gives final approval**

**Pipeline:**
```
Stage 1: Codex Spec Writing
    ↓
Stage 2: Spec Gate Validation
    ↓
Stage 3: Implementation + Tests
    ↓
+---------+---------+
|                   |
v                   v
Stage 3 Bundle    Stage 4 Bundle
(NO CODE)         (NO SPEC PROSE)
|                   |
v                   v
Spec Compliance   Exploit Hunt
Review            Review
|                   |
+---------+---------+
          |
          v
    Stage 5: Red-Team Loop
    (until all HIGH/MED CLOSED)
          |
          v
    Stage 6: Codex Final Gate
```

**Blindness Rules:**

| Stage | Sees | Does NOT See |
|-------|------|--------------|
| 3 (Spec Compliance) | Specs, test results | Source code, test code |
| 4 (Exploit Hunt) | Code, invariants list | Spec prose, attack descriptions |

**Configuration:**

```json
{
  "blind_audit_sc": {
    "enable_invariants": true,
    "min_fuzz_runs": 5000,
    "require_slither": true,
    "blind_enforcement": "strict",
    "max_redteam_iterations": 10,
    "require_regression_tests": true
  }
}
```

**Artifacts Generated:**

```
.task/<run_id>/
  ├── bundle-stage3/          # Specs + test summaries (NO code)
  ├── bundle-stage4/          # Code + invariants (NO spec prose)
  ├── bundle-final/           # Everything for final gate
  └── run-metadata.json

docs/reviews/
  ├── spec-compliance-review.md
  ├── exploit-hunt-review.md
  ├── red-team-issue-log.md
  └── final-codex-gate.md
```

---

## Domain-Specific Skills

### `/defi-audit-complex`

Trust-model-first workflow for high-value DeFi protocols.

```bash
/defi-audit-complex
```

Use when:
- Auditing complex protocols with big-fund exposure
- Reviewing liquidation/settlement logic
- Cross-module flows with high TVL

### `/gas-opt-contracts`

Solidity gas optimization with priority ordering.

```bash
/gas-opt-contracts
```

Use when:
- Optimizing hot-path contract functions
- Redesigning storage layout
- Need gas benchmark evidence

### `/risex-contract-refactor`

Audit-friendly, invariant-driven contract refactoring.

```bash
/risex-contract-refactor
```

Use when:
- Refactoring match/settlement flows
- Decomposing monolithic contracts
- Need behavior freeze + test mapping

---

## Architecture

### Task-Based Enforcement

Pipeline uses `blockedBy` dependencies for structural enforcement:

```
T1: Gate 0 (Threat Model)     blockedBy: []
T2: Gate 1 (Architecture)     blockedBy: [T1]
T3: Gate 2 (Test Plan)        blockedBy: [T2]
T4: Gate 3 (Implementation)   blockedBy: [T3]
T5: Gate 4 (Static Analysis)  blockedBy: [T4]
T6: Gate 5 (Gas/Perf)         blockedBy: [T5]
T7: Review - Sonnet           blockedBy: [T6]
T8: Review - Opus             blockedBy: [T7]
T9: Review - Codex            blockedBy: [T8]
```

### Hook Enforcement

| Hook | File | Purpose |
|------|------|---------|
| UserPromptSubmit | `guidance-hook.js` | Phase guidance based on artifacts |
| SubagentStop | `review-validator.js` | Validates reviewer AC coverage |
| SubagentStop | `gate-validator.js` | Validates gate artifacts |

### Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| threat-modeler | opus | Gate 0: Threat model + invariants |
| architect | opus | Gate 1: Architecture + storage |
| test-planner | opus/sonnet | Gate 2: Test mapping |
| sc-implementer | sonnet | Gate 3: TDD implementation |
| security-auditor | opus | Gate 4: Static analysis triage |
| perf-optimizer | sonnet | Gate 5: Gas optimization |
| sc-code-reviewer | sonnet/opus | Final: Security review |
| codex-reviewer | external | Final: Codex approval |

**Blind-Audit Pipeline Agents:**

| Agent | Model | Stage | Purpose |
|-------|-------|-------|---------|
| strategist-codex | external | 1 | Codex writes specs |
| spec-compliance-reviewer | opus | 3 | Blind to code, validates specs |
| exploit-hunter | opus | 4 | Blind to spec prose, hunts exploits |
| redteam-verifier | sonnet | 5 | Verifies fixes, closes issues |
| final-gate-codex | external | 6 | Codex final approval |

---

## Extending the Pipeline

### Adding a New Analyzer

1. Add config toggle in `.claude-codex.json`:
   ```json
   "enable_mythril": false
   ```

2. Update `security-auditor.md` agent with analyzer instructions

3. Add artifact validation in `gate-validator.js`:
   ```javascript
   if (config.enable_mythril && !existsSync('reports/mythril.json')) {
     return { decision: 'block', reason: 'mythril.json missing' };
   }
   ```

### Adding a New Gate

1. Create agent in `agents/` directory

2. Add task in pipeline initialization (with correct blockedBy)

3. Define required artifacts

4. Add validation in `gate-validator.js`

5. Update SKILL.md documentation

### Modifying Strictness

Edit `.claude-codex.json` in your project:

```json
{
  "smart_contract_secure": {
    "gate_strictness": "medium",
    "enable_slither": false,
    "fuzz_runs": 1000
  }
}
```

---

## Troubleshooting

### Pipeline Stuck

1. Check task state: Use `TaskList()` to see blocked tasks
2. Check artifacts: Read `docs/` and `reports/` directories
3. Reset pipeline: `"${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" reset`

### Gate Validation Failing

1. Read the gate artifact (`.task/*.json`)
2. Check the blocking reason in hook output
3. Ensure all required sections exist in docs
4. Verify test logs exist in `reports/`

### Slither Not Found

```bash
# Install Slither
pip install slither-analyzer

# Or disable in config
{
  "smart_contract_secure": {
    "enable_slither": false
  }
}
```

---

## File Reference

### Templates

Copy from `${CLAUDE_PLUGIN_ROOT}/templates/` to your project:

| Template | Destination |
|----------|-------------|
| `threat-model.template.md` | `docs/security/threat-model.md` |
| `design.template.md` | `docs/architecture/design.md` |
| `test-plan.template.md` | `docs/testing/test-plan.md` |
| `perf-report.template.md` | `docs/performance/perf-report.md` |
| `.claude-codex.json` | `.claude-codex.json` (project root) |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/orchestrator.sh` | Initialize/reset pipeline |
| `scripts/codex-review.js` | Codex CLI wrapper for plan/code reviews |
| `scripts/codex-design.js` | Codex CLI wrapper for design/spec generation |
| `scripts/codex-final-gate.js` | Codex CLI wrapper for blind-audit final gate |
| `scripts/generate-bundle-stage3.js` | Generate blind Stage 3 bundle (NO code) |
| `scripts/generate-bundle-stage4.js` | Generate blind Stage 4 bundle (NO spec prose) |
| `scripts/generate-bundle-final.js` | Generate complete final bundle |
| `scripts/extract-invariants-list.js` | Extract numbered invariants from threat-model |
| `scripts/extract-public-api.js` | Extract contract interfaces from source |

### Hooks

| Hook | Purpose |
|------|---------|
| `hooks/guidance-hook.js` | Phase guidance based on artifacts |
| `hooks/review-validator.js` | Validates reviewer AC coverage |
| `hooks/gate-validator.js` | Validates gate artifacts |
| `hooks/bundle-validator.js` | Enforces blindness constraints |
| `hooks/blind-audit-gate-validator.js` | Validates blind-audit pipeline gates |
| `hooks/redteam-closure-validator.js` | Ensures all HIGH/MED CLOSED |

---

## License

MIT
