# Security Finding Suppressions

> **Gate 4 Artifact** - This document tracks justified suppressions of static analysis findings.

## Suppression Policy

- **High severity findings** MUST be either fixed OR have justified suppression with evidence
- **Medium severity findings** SHOULD be fixed or suppressed with justification
- **Low/Info severity findings** MAY be suppressed without detailed justification

## Suppression Requirements

Each suppression MUST include:

1. **Justification** - Why this is not a vulnerability (or acceptable risk)
2. **Evidence** - Tests, invariants, code analysis, or formal proof
3. **Approval** - Who approved the suppression and when
4. **Review date** - When this suppression should be re-evaluated

---

## Active Suppressions

### SUPP-001: [Finding Title]

| Field | Value |
|-------|-------|
| **Tool** | [Slither/Semgrep/Mythril] |
| **Detector** | [detector-name] |
| **Severity** | [Critical/High/Medium/Low] |
| **Confidence** | [High/Medium/Low] |
| **Location** | `[src/Contract.sol:function():line]` |

**Finding Description:**
[Original finding text from the tool]

**Code Snippet:**
```solidity
// The flagged code
```

**Justification:**
This is a false positive / acceptable risk because:
1. [Reason 1 - e.g., "The function uses nonReentrant modifier"]
2. [Reason 2 - e.g., "External call occurs after all state changes (CEI)"]
3. [Reason 3 - e.g., "The callback cannot re-enter because..."]

**Evidence:**

| Evidence Type | Location | Description |
|---------------|----------|-------------|
| Unit test | `test/unit/Contract.t.sol::test_X` | Verifies the behavior |
| Invariant test | `test/invariant/Inv.t.sol::invariant_X` | Property holds |
| Code review | PR #123 or commit abc123 | Reviewed by [name] |
| Formal proof | (optional) | If applicable |

**Mitigating Controls:**
- [Control 1 - e.g., "ReentrancyGuard on function"]
- [Control 2 - e.g., "Rate limiting in place"]

**Risk Assessment:**
- **Likelihood of exploit:** [Very Low/Low/Medium]
- **Impact if exploited:** [Low/Medium/High/Critical]
- **Residual risk:** [Acceptable/Needs monitoring]

**Approval:**
- **Approved by:** [Name]
- **Approval date:** [YYYY-MM-DD]
- **Review by:** [YYYY-MM-DD or "Next audit"]

---

### SUPP-002: [Next Finding Title]

| Field | Value |
|-------|-------|
| **Tool** | [Tool] |
| **Detector** | [detector] |
| **Severity** | [Severity] |
| **Confidence** | [Confidence] |
| **Location** | `[location]` |

[Continue pattern...]

---

## Rejected Suppressions

> Findings that were considered for suppression but rejected (must be fixed).

### REJ-001: [Finding Title]

| Field | Value |
|-------|-------|
| **Tool** | [Tool] |
| **Detector** | [detector] |
| **Severity** | [Severity] |
| **Location** | `[location]` |

**Reason for Rejection:**
[Why this finding cannot be safely suppressed]

**Required Fix:**
[What must be done to address this finding]

**Fix Tracking:**
- Issue/PR: [link]
- Status: [Pending/In Progress/Fixed]

---

## Suppression History

| ID | Finding | Date Added | Date Reviewed | Status |
|----|---------|------------|---------------|--------|
| SUPP-001 | [title] | YYYY-MM-DD | YYYY-MM-DD | Active |
| SUPP-002 | [title] | YYYY-MM-DD | - | Active |

---

## Review Schedule

| Suppression | Last Review | Next Review | Reviewer |
|-------------|-------------|-------------|----------|
| SUPP-001 | YYYY-MM-DD | YYYY-MM-DD | [Name] |
| SUPP-002 | - | YYYY-MM-DD | [Name] |

---

## Appendix: Tool Configuration

### Slither Configuration

```yaml
# slither.config.json (if using)
{
  "detectors_to_exclude": [],
  "exclude_informational": false,
  "exclude_low": false
}
```

### Semgrep Configuration

```yaml
# .semgrep.yml (if using custom rules)
rules: []
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [Date] | [Author] | Initial suppressions document |
