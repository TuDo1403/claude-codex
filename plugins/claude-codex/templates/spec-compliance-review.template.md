# Spec Compliance Review

**Reviewer:** spec-compliance-reviewer (opus)
**Bundle:** bundle-stage3 (NO CODE)
**Date:** [ISO8601]

---

## Decision: [APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION]

---

## Invariant-Test Mapping Audit

| Invariant | Description | Test Mapped | Test Status | Verdict |
|-----------|-------------|-------------|-------------|---------|
| IC-1 | [description] | [Yes/No] | [PASS/FAIL/-] | [OK/MISSING_TEST/TEST_NOT_FOUND/TEST_FAILING/AMBIGUOUS] |
| IC-2 | [description] | [Yes/No] | [PASS/FAIL/-] | [verdict] |
| IS-1 | [description] | [Yes/No] | [PASS/FAIL/-] | [verdict] |
| IA-1 | [description] | [Yes/No] | [PASS/FAIL/-] | [verdict] |
| IT-1 | [description] | [Yes/No] | [PASS/FAIL/-] | [verdict] |
| IB-1 | [description] | [Yes/No] | [PASS/FAIL/-] | [verdict] |

**Summary:** X of Y invariants properly mapped and tested.

### Verdict Legend:
- **OK** - Invariant mapped to test, test passes
- **MISSING_TEST** - Invariant not mapped in test-plan.md
- **TEST_NOT_FOUND** - Test mentioned but not in test-summary.md
- **TEST_FAILING** - Test exists but fails
- **AMBIGUOUS** - Mapping unclear or multiple interpretations

---

## Acceptance Criteria Audit

| AC ID | Description | Measurable | Notes |
|-------|-------------|------------|-------|
| AC-SEC-1 | [description] | [YES/NO] | [notes] |
| AC-SEC-2 | [description] | [YES/NO] | [notes] |
| AC-FUNC-1 | [description] | [YES/NO] | [notes] |

**Summary:** X of Y acceptance criteria are measurable.

### Measurability Criteria:
- **YES** - Has specific threshold, condition, or verifiable artifact
- **NO** - Vague, subjective, or not verifiable

---

## Spec Completeness Audit

### Threat Model (docs/security/threat-model.md)
- [ ] Assets at Risk (with dollar values)
- [ ] Trust Assumptions (roles, powers, constraints)
- [ ] Attacker Classes (capabilities, motivations)
- [ ] Attack Surfaces (entry points, vectors)
- [ ] Invariants (IC-*, IS-*, IA-*, IT-*, IB-*)
- [ ] State Machine (valid transitions)
- [ ] Acceptance Criteria (AC-SEC-*, AC-FUNC-*)

### Architecture Design (docs/architecture/design.md)
- [ ] Module Boundaries (contracts, responsibilities)
- [ ] Storage Layout (with slot numbers)
- [ ] External Call Policy (CEI compliance)
- [ ] Error Model (custom errors)
- [ ] Event Model (events)
- [ ] Upgrade Strategy (if applicable)

### Test Plan (docs/testing/test-plan.md)
- [ ] Invariant-Test Mapping Table
- [ ] Attack Simulations (all 6 categories)
- [ ] Coverage Targets

---

## Attack Simulation Coverage

| Category | Covered | Test(s) |
|----------|---------|---------|
| Reentrancy | [Yes/No] | [test names] |
| Fee-on-transfer / Rebasing | [Yes/No] | [test names] |
| Sandwich / MEV | [Yes/No] | [test names] |
| Oracle Manipulation | [Yes/No] | [test names] |
| DoS / Griefing | [Yes/No] | [test names] |
| Flash Loan | [Yes/No] | [test names] |

**Summary:** X of 6 attack categories covered.

---

## Required Changes

*If Decision is NEEDS_CHANGES, list required changes. Each prefixed with [CODEX] for strategist.*

- [CODEX] [Change 1]
- [CODEX] [Change 2]
- [CODEX] [Change 3]

---

## Clarification Questions

*If Decision is NEEDS_CLARIFICATION, list questions.*

1. [Question 1]
2. [Question 2]

---

## Notes

*Additional observations, recommendations, or concerns.*

[Notes here]

---

## Blindness Verification

- [x] Reviewed from bundle-stage3 only
- [x] Did NOT see any source code (.sol files)
- [x] Did NOT see any test code
- [x] Validated against test-summary.md results only
