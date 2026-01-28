# Red-Team Issue Log

**Pipeline Run:** [run_id]
**Last Updated:** [ISO8601]
**Status:** X of Y HIGH/MED CLOSED

---

## Summary

| Severity | Total | OPEN | FIXED_PENDING | CLOSED |
|----------|-------|------|---------------|--------|
| HIGH | 0 | 0 | 0 | 0 |
| MED | 0 | 0 | 0 | 0 |
| LOW | 0 | 0 | 0 | 0 |

**Ready for Final Gate:** [Yes/No]

---

## RT-001

- **Original ID:** EH-1
- **Severity:** HIGH
- **Title:** [Issue title]
- **Description:**
  [Detailed description of the vulnerability from exploit-hunt-review]

- **Affected:** [Contract.sol::function()]

- **Repro / Hypothesis:**
  1. [Step 1]
  2. [Step 2]
  3. [Step 3]

- **Expected Fix:**
  [Description of what needs to change]

- **Regression Test Required:** `test/security/[TestFile].t.sol::[test_name]`

- **Status:** [OPEN|FIXED_PENDING_VERIFY|CLOSED]

- **Fix Applied:**
  [Description of the fix applied, or "pending" if not yet fixed]

- **Fix Verified:** [Yes/No]

- **Test Verified:** [Yes/No - include test output summary]

- **Verifier Notes:**
  [Notes from verification - issues found, what was checked, etc.]

- **Closed At:** [ISO8601 timestamp when CLOSED, or "-"]

---

## RT-002

- **Original ID:** EH-2
- **Severity:** MED
- **Title:** [Issue title]
- **Description:**
  [Description]

- **Affected:** [Contract.sol::function()]

- **Repro / Hypothesis:**
  [Steps]

- **Expected Fix:**
  [Fix description]

- **Regression Test Required:** `test/security/[TestFile].t.sol::[test_name]`

- **Status:** [OPEN|FIXED_PENDING_VERIFY|CLOSED]

- **Fix Applied:**
  [Description or "pending"]

- **Fix Verified:** [Yes/No]

- **Test Verified:** [Yes/No]

- **Verifier Notes:**
  [Notes]

- **Closed At:** [timestamp or "-"]

---

## Status Transition Rules

```
OPEN
  | (implementer applies fix)
  v
FIXED_PENDING_VERIFY
  | (verifier checks)
  |
  +-- Fix incomplete --> OPEN (with feedback)
  |
  +-- Fix complete, test missing --> FIXED_PENDING_VERIFY (needs test)
  |
  +-- Fix complete, test passes --> CLOSED
```

---

## Verification Checklist

For each issue to be CLOSED:

### Fix Quality
- [ ] Addresses root cause, not just symptoms
- [ ] Does not break existing functionality
- [ ] Does not introduce new vulnerabilities
- [ ] Follows best practices (CEI, nonReentrant, etc.)

### Regression Test Quality
- [ ] Test file exists at specified path
- [ ] Test would have FAILED before fix
- [ ] Test PASSES after fix
- [ ] Test has meaningful assertions
- [ ] Test covers edge cases

---

## Iteration History

| Iteration | Date | Changes | Issues Resolved |
|-----------|------|---------|-----------------|
| 1 | [date] | [summary] | [list] |
| 2 | [date] | [summary] | [list] |
