# Claude Codex Agents Reference

This document provides a consolidated reference for all agents in the Claude Codex plugin.

## Agent Overview

### General Pipeline Agents

| Agent | File | Model | Purpose |
|-------|------|-------|---------|
| requirements-gatherer | `agents/requirements-gatherer.md` | opus | Business Analyst + PM for requirements elicitation |
| planner | `agents/planner.md` | opus | Architect + Fullstack for implementation planning |
| plan-reviewer | `agents/plan-reviewer.md` | sonnet/opus | Architecture + Security + QA plan review |
| implementer | `agents/implementer.md` | sonnet | Fullstack + TDD implementation |
| code-reviewer | `agents/code-reviewer.md` | sonnet/opus | Security + Performance code review |
| codex-reviewer | `agents/codex-reviewer.md` | external | Codex final gate |

### Smart Contract Secure Pipeline Agents

**NEW: Codex leads design, Opus reviews, Claude implements, Codex approves.**

| Agent | File | Model | Gate | Purpose |
|-------|------|-------|------|---------|
| codex-designer | `agents/codex-designer.md` | external | 0 | **Codex leads** - threat model, architecture, test plan |
| opus-design-reviewer | `agents/opus-design-reviewer.md` | opus | 1 | Reviews Codex's design for gaps |
| sc-implementer | `agents/sc-implementer.md` | sonnet | 2 | TDD Solidity implementation |
| security-auditor | `agents/security-auditor.md` | opus | 3 | Static analysis + suppression governance |
| perf-optimizer | `agents/perf-optimizer.md` | sonnet | 4 | Gas optimization with evidence |
| sc-code-reviewer | `agents/sc-code-reviewer.md` | sonnet/opus | Final | Security-focused code review |
| codex-reviewer | `agents/codex-reviewer.md` | external | Final | **Codex final gate** - must approve |

**Legacy agents (still available but superseded by codex-designer):**
| Agent | File | Model | Purpose |
|-------|------|-------|---------|
| threat-modeler | `agents/threat-modeler.md` | opus | Threat model (use codex-designer instead) |
| architect | `agents/architect.md` | opus | Architecture (use codex-designer instead) |
| test-planner | `agents/test-planner.md` | opus/sonnet | Test mapping (use codex-designer instead) |

### Blind-Audit Pipeline Agents

**NEW: 6-stage pipeline with strict blindness enforcement for maximum security.**

| Agent | File | Model | Stage | Purpose |
|-------|------|-------|-------|---------|
| strategist-codex | `agents/strategist-codex.md` | external | 1 | **Codex writes specs** - threat model, design, test plan |
| spec-compliance-reviewer | `agents/spec-compliance-reviewer.md` | opus | 3 | **Blind to code** - validates specs vs test results |
| exploit-hunter | `agents/exploit-hunter.md` | opus | 4 | **Blind to spec narrative** - hunts exploits in code |
| redteam-verifier | `agents/redteam-verifier.md` | sonnet | 5 | Verifies fixes, closes HIGH/MED issues |
| final-gate-codex | `agents/final-gate-codex.md` | external | 6 | **Codex final gate** - all gates must pass |

**Blindness Rules:**
- Stage 3 reviewer sees specs + test results, NO code
- Stage 4 reviewer sees code + invariants list, NO spec narrative

---

## Agent Outputs

### General Pipeline

| Agent | Output File | Key Fields |
|-------|-------------|------------|
| requirements-gatherer | `.task/user-story.json` | acceptance_criteria, scope |
| planner | `.task/plan-refined.json` | steps, risk_assessment |
| plan-reviewer | `.task/review-{model}.json` | status, requirements_coverage |
| implementer | `.task/impl-result.json` | status, files_modified |
| code-reviewer | `.task/code-review-{model}.json` | status, acceptance_criteria_verification |
| codex-reviewer | `.task/review-codex.json` | status (APPROVED/NEEDS_CHANGES) |

### Smart Contract Secure Pipeline

| Agent | Output Files | Key Artifacts |
|-------|--------------|---------------|
| threat-modeler | `docs/security/threat-model.md`, `.task/threat-model.json` | invariants, acceptance_criteria |
| architect | `docs/architecture/design.md`, `.task/architecture.json` | storage_layout, external_call_policy |
| test-planner | `docs/testing/test-plan.md`, `.task/test-plan.json` | invariant_mapping, attack_simulations |
| sc-implementer | `.task/impl-result.json`, `reports/forge-test.log` | test_results, invariant_results |
| security-auditor | `reports/slither.json`, `.task/static-analysis.json` | findings, suppressions |
| perf-optimizer | `reports/gas-snapshots.md`, `.task/perf-result.json` | baseline, optimizations |
| sc-code-reviewer | `.task/code-review-{model}.json` | exploit_analysis, invariant_coverage |

### Blind-Audit Pipeline

| Agent | Output Files | Key Artifacts |
|-------|--------------|---------------|
| strategist-codex | `docs/security/threat-model.md`, `docs/architecture/design.md`, `docs/testing/test-plan.md`, `.task/codex-spec.json` | invariants, acceptance_criteria, attack_simulations |
| spec-compliance-reviewer | `docs/reviews/spec-compliance-review.md`, `.task/spec-compliance-review.json` | invariant_audit, acceptance_criteria_audit, attack_coverage |
| exploit-hunter | `docs/reviews/exploit-hunt-review.md`, `.task/exploit-hunt-review.json` | exploits_confirmed, invariant_coverage, required_tests |
| redteam-verifier | `docs/reviews/red-team-issue-log.md`, `.task/red-team-issues.json` | issues, summary, ready_for_final_gate |
| final-gate-codex | `docs/reviews/final-codex-gate.md`, `.task/final-gate.json` | gates, decision, deployment_ready |

---

## Review Status Values

All reviewer agents output one of these statuses:

| Status | Meaning | Action |
|--------|---------|--------|
| `approved` | No blocking issues | Proceed to next stage |
| `needs_changes` | Issues found | Create fix task, same-reviewer re-review |
| `needs_clarification` | Cannot evaluate | Provide clarification, same-reviewer re-review |
| `rejected` | Fundamental issues | Escalate to user (Codex plan only) |

---

## Agent Invocation

### Via Task Tool

```
Task(
  subagent_type: "claude-codex:<agent-name>",
  model: "<model>",
  prompt: "[Instructions + context]"
)
```

**Examples:**

```
# General pipeline
Task(subagent_type: "claude-codex:requirements-gatherer", model: "opus", prompt: "...")
Task(subagent_type: "claude-codex:implementer", model: "sonnet", prompt: "...")

# Smart contract secure pipeline
Task(subagent_type: "claude-codex:threat-modeler", model: "opus", prompt: "...")
Task(subagent_type: "claude-codex:sc-implementer", model: "sonnet", prompt: "...")
```

---

## Detailed Agent Specifications

### requirements-gatherer (General)

**Purpose:** Elicit requirements, produce user story with acceptance criteria.

**Key Responsibilities:**
- Probe for unstated needs and constraints
- Define measurable acceptance criteria (Given/When/Then)
- Bound scope (in/out of scope)
- Identify test criteria for TDD

**Output Schema:** See `agents/requirements-gatherer.md`

---

### threat-modeler (Smart Contract)

**Purpose:** Create comprehensive threat model for fund-sensitive contracts.

**Key Responsibilities:**
- Enumerate assets at risk
- Define trust assumptions and roles
- Map attack surfaces and vectors
- Enumerate invariants (IC-*, IS-*, IA-*, IT-*, IB-*)
- Define acceptance criteria

**Required Sections in Output:**
- Assets
- Trust assumptions
- Attacker classes
- Attack surfaces
- Invariants (with formal IDs)
- State machine
- Acceptance criteria

**Gate Blocking:** Missing invariants or acceptance criteria

---

### architect (Smart Contract)

**Purpose:** Design secure, gas-efficient contract architecture.

**Key Responsibilities:**
- Define module boundaries
- Document storage layout with slot assignments
- Define external call policy
- Design error/event model
- Plan upgrade strategy

**Required Sections in Output:**
- Module boundaries
- Storage layout (with slot numbers)
- External call policy
- Error model
- Event model

**Gate Blocking:** Missing storage layout or external call policy

---

### test-planner (Smart Contract)

**Purpose:** Map all invariants to specific tests, plan attack simulations.

**Key Responsibilities:**
- Map each invariant to test type and file
- Plan all 6 attack simulation categories
- Define coverage targets
- Create test file structure

**Required Attack Simulations:**
1. Reentrancy tests
2. Fee-on-transfer / rebasing token tests
3. Sandwich attack tests
4. Oracle manipulation tests
5. DoS / gas griefing tests
6. Flash loan attack tests

**Gate Blocking:** Any invariant without mapped test

---

### sc-implementer (Smart Contract)

**Purpose:** Implement contracts with TDD discipline using Foundry.

**Key Responsibilities:**
- Write invariant tests first
- Write unit tests
- Implement minimal code to pass
- Run fuzz and invariant tests
- Save all test outputs to reports/

**Test Order:**
1. Invariant tests
2. Unit tests
3. Implementation
4. Fuzz tests
5. Full test suite

**Gate Blocking:** forge test fails, missing test logs

---

### security-auditor (Smart Contract)

**Purpose:** Run static analyzers, triage findings, manage suppressions.

**Key Responsibilities:**
- Run Slither (if enabled)
- Run Semgrep (if enabled)
- Categorize findings by severity
- For High severity: fix or justify suppression
- Document all suppressions with evidence

**Suppression Requirements:**
- Justification (why not vulnerable)
- Evidence (tests, invariants, proofs)
- Approval (who approved, when)

**Gate Blocking:** Unsuppressed High severity findings

---

### perf-optimizer (Smart Contract)

**Purpose:** Optimize gas usage with before/after evidence.

**Key Responsibilities:**
- Capture baseline gas measurements
- Apply optimizations
- If logic changed: rerun ALL tests
- Capture after measurements
- Generate diff and documentation

**Evidence Requirements:**
- Before snapshot
- After snapshot
- Diff summary
- Test rerun evidence (if logic changed)

**Gate Blocking:** Missing evidence, test failures after optimization

---

### sc-code-reviewer (Smart Contract)

**Purpose:** Comprehensive security review for smart contracts.

**Five Mandatory Checks:**
1. Exploit path analysis
2. Invariant coverage audit
3. Storage/upgrade audit
4. Economic/MEV attack audit
5. Gas regression check

**Key Outputs:**
- Exploit paths (if any)
- Invariant coverage status
- Storage safety assessment
- Economic risk assessment
- Gas regression status

---

## Common Anti-Patterns

### All Agents

- Do not skip required outputs
- Do not use bash for file writing (use Write tool)
- Do not leave JSON invalid

### Worker Agents (implementer, sc-implementer, perf-optimizer)

- Do NOT interact with user
- Do NOT ask "should I continue?"
- Do NOT use AskUserQuestion
- Just continue working

### Reviewer Agents

- Do NOT approve with unverified acceptance criteria
- Do NOT skip any mandatory check
- Do NOT provide vague feedback

---

## Hook Validation

### SubagentStop Hooks

| Hook | Validates |
|------|-----------|
| `review-validator.js` | AC coverage in reviews |
| `gate-validator.js` | Gate artifacts exist and meet schema |

### Validation Failures

If hook returns `{"decision": "block", "reason": "..."}`:
- Agent output is rejected
- Orchestrator creates fix task
- Same agent re-runs after fix

---

## Model Recommendations

| Task Type | Recommended Model | Reason |
|-----------|-------------------|--------|
| Deep analysis | opus | Comprehensive reasoning |
| Implementation | sonnet | Balanced speed/quality |
| Quick review | sonnet | Fast iteration |
| Final gate | codex (external) | Independent validation |

---

## Extending Agents

### Creating a New Agent

1. Create `agents/new-agent.md` with:
   - YAML frontmatter (name, description, tools)
   - Clear responsibilities
   - Output format specification
   - Quality checklist
   - Anti-patterns

2. Add to orchestrator task chain

3. Add hook validation (if needed)

4. Update this AGENTS.md reference

### Agent File Structure

```markdown
---
name: agent-name
description: Brief description
tools: Read, Write, Edit, Glob, Grep, Bash, ...
disallowedTools: (optional) Edit, Write
---

# Agent Name

[Description and responsibilities]

## Process

[Step-by-step process]

## Output Format

[JSON/Markdown output specification]

## Quality Checklist

[Verification checklist]

## CRITICAL: Completion Requirements

[What must be done before completing]
```
