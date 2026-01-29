# Opus Contrarian Attack Plan

**Reviewer:** opus-attack-planner
**Model:** opus
**Bundle:** bundle-stage4a (NO SPEC PROSE)
**Date:** {{DATE}}

## Summary

- **Total Hypotheses:** {{TOTAL_HYPOTHESES}} (min 5)
- **Economic/MEV Hypotheses:** {{ECONOMIC_COUNT}} (min 2)
- **DoS/Gas Grief Hypotheses:** {{DOS_COUNT}} (min 2)
- **Other Hypotheses:** {{OTHER_COUNT}}

---

## Attack Hypotheses

### [ECON-1] Hypothesis: {{NAME}} ({{SEVERITY}})

**Category:** Economic/MEV
**Severity:** HIGH|MED|LOW

**Preconditions:**
- Condition 1
- Condition 2

**Attack Steps:**
1. Step 1
2. Step 2
3. ...

**Invariant Violated:** {{INVARIANT_ID}}
**Why It Breaks:** {{EXPLANATION}}

**Demonstration Test:**
```solidity
function test_ECON1_{{testName}}() public {
    // Setup preconditions
    // Execute attack steps
    // Assert invariant violation
}
```

**Evidence Search Required:**
- [ ] Check function X for Y
- [ ] Verify guard on Z

---

### [DOS-1] Hypothesis: {{NAME}} ({{SEVERITY}})

**Category:** DoS/Gas Grief
**Severity:** HIGH|MED|LOW

**Preconditions:**
- ...

**Attack Steps:**
1. ...

**Invariant Violated:** {{INVARIANT_ID}}
**Why It Breaks:** {{EXPLANATION}}

**Demonstration Test:**
```solidity
function test_DOS1_{{testName}}() public {
    // ...
}
```

**Evidence Search Required:**
- [ ] ...

---

## Severity Summary

| ID | Category | Severity | Invariant | Confidence |
|----|----------|----------|-----------|------------|
| ECON-1 | Economic | HIGH | IC-1 | High |
| DOS-1 | DoS | MED | IB-2 | Medium |

## Top 5 Priority Attacks

1. **[ECON-1]** - Reason
2. **[DOS-1]** - Reason
3. **[...]** - Reason
4. **[...]** - Reason
5. **[...]** - Reason

## Open Questions for Dispute

1. Question about assumption X
2. Question about edge case Y
3. ...
