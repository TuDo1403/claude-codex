# Performance Report: [Protocol Name]

> **Gate 5 Artifact** - This document records gas optimization results with before/after evidence.

## 1. Baseline Measurements

### 1.1 Environment

| Setting | Value |
|---------|-------|
| Solidity Version | 0.8.x |
| Optimizer | Enabled |
| Optimizer Runs | 200 |
| EVM Version | Shanghai |
| Foundry Profile | default |

### 1.2 Function Gas Costs (Before Optimization)

| Function | Min Gas | Avg Gas | Max Gas | Calls | Notes |
|----------|---------|---------|---------|-------|-------|
| deposit() | [min] | [avg] | [max] | [n] | [notes] |
| withdraw() | [min] | [avg] | [max] | [n] | [notes] |
| liquidate() | [min] | [avg] | [max] | [n] | [notes] |
| setFeeRate() | [min] | [avg] | [max] | [n] | [notes] |

### 1.3 Storage Analysis (Before)

| Contract | Storage Slots | Packed Slots | Wasted Bytes | Notes |
|----------|---------------|--------------|--------------|-------|
| VaultCore | [n] | [n] | [n] | [notes] |
| VaultAdmin | [n] | [n] | [n] | [notes] |

### 1.4 Baseline Snapshot

```
# reports/.gas-snapshot-before
VaultCoreTest:test_deposit() (gas: 45000)
VaultCoreTest:test_withdraw() (gas: 38000)
VaultCoreTest:test_liquidate() (gas: 80000)
...
```

## 2. Optimizations Applied

### 2.1 OPT-001: [Optimization Name]

**Category:** Storage / Computation / External Calls / Loops

**Description:**
[Detailed description of the optimization applied]

**Before:**
```solidity
// Code before optimization
```

**After:**
```solidity
// Code after optimization
```

**Impact:**
- Gas saved: [X] per call
- Functions affected: [list]
- Logic changed: Yes/No

**If logic changed:**
- [ ] All tests pass
- [ ] All invariants pass
- [ ] Rerun evidence: reports/test-after-opt-001.log

---

### 2.2 OPT-002: [Optimization Name]

**Category:** Storage / Computation / External Calls / Loops

**Description:**
[Detailed description]

**Before:**
```solidity
// Code before
```

**After:**
```solidity
// Code after
```

**Impact:**
- Gas saved: [X] per call
- Functions affected: [list]
- Logic changed: Yes/No

---

### 2.3 OPT-003: [Optimization Name]

[Continue pattern for each optimization...]

## 3. After Measurements

### 3.1 Function Gas Costs (After Optimization)

| Function | Before | After | Saved | % Change | Status |
|----------|--------|-------|-------|----------|--------|
| deposit() | [before] | [after] | [saved] | [%] | ✓/⚠️ |
| withdraw() | [before] | [after] | [saved] | [%] | ✓/⚠️ |
| liquidate() | [before] | [after] | [saved] | [%] | ✓/⚠️ |
| setFeeRate() | [before] | [after] | [saved] | [%] | ✓/⚠️ |

### 3.2 After Snapshot

```
# reports/.gas-snapshot-after
VaultCoreTest:test_deposit() (gas: 42000)
VaultCoreTest:test_withdraw() (gas: 35500)
VaultCoreTest:test_liquidate() (gas: 78000)
...
```

### 3.3 Diff Summary

```
# forge snapshot --diff reports/.gas-snapshot-before

VaultCoreTest:test_deposit() (gas: -3000 (-6.67%))
VaultCoreTest:test_withdraw() (gas: -2500 (-6.58%))
VaultCoreTest:test_liquidate() (gas: -2000 (-2.50%))
...

Overall gas change: -7500 (-5.25%)
```

## 4. Verification Status

### 4.1 Test Suite Results

| Test Suite | Before | After | Status |
|------------|--------|-------|--------|
| Unit tests | PASS ([n] tests) | PASS ([n] tests) | ✓ |
| Fuzz tests ([runs] runs) | PASS | PASS | ✓ |
| Invariant tests ([runs] runs) | PASS | PASS | ✓ |
| Attack simulations | PASS | PASS | ✓ |

### 4.2 Invariants Verified After Optimization

| Invariant | Status | Evidence |
|-----------|--------|----------|
| IC-1 (Conservation) | ✓ Pass | invariant-after-opt.log |
| IC-2 (Reserve) | ✓ Pass | invariant-after-opt.log |
| IS-1 (Consistency) | ✓ Pass | invariant-after-opt.log |
| IA-1 (Access) | ✓ Pass | invariant-after-opt.log |
| IB-1 (Bounds) | ✓ Pass | invariant-after-opt.log |

### 4.3 Coverage After Optimization

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Line coverage | [%] | [%] | ✓/⚠️ |
| Branch coverage | [%] | [%] | ✓/⚠️ |
| Function coverage | [%] | [%] | ✓/⚠️ |

### 4.4 EVMbench-Aligned Security Performance Scorecard

| Metric | Definition | Target | Actual | Status |
|--------|------------|--------|--------|--------|
| Discovery coverage | Reviewed entrypoints / total entrypoints | 100% | [%] | ✓/⚠️ |
| High/Med closure rate | Patched and validated High/Med findings / validated High/Med findings | 100% | [%] | ✓/⚠️ |
| Exploit replay block rate | Patched findings where exploit replay fails / patched findings | 100% | [%] | ✓/⚠️ |
| Patch regression rate | Patched findings that break existing tests | 0% | [%] | ✓/⚠️ |
| Hint level reached | none / low / medium / high | <= medium | [level] | ✓/⚠️ |
| Token efficiency | (validated High/Med findings) / 10k output tokens | project-specific | [value] | ✓/⚠️ |

**Scorecard Notes:**
- Discovery is usually the bottleneck; log why coverage is incomplete.
- If `high` hints were required, document what was missing in baseline discovery.
- Include replay evidence locations for each High/Med finding ID.

## 5. Summary

### 5.1 Optimizations Applied

| ID | Optimization | Gas Saved | Logic Changed | Verified |
|----|--------------|-----------|---------------|----------|
| OPT-001 | [name] | [gas] | Yes/No | ✓ |
| OPT-002 | [name] | [gas] | Yes/No | ✓ |
| OPT-003 | [name] | [gas] | Yes/No | ✓ |

### 5.2 Total Impact

| Metric | Value |
|--------|-------|
| Total gas saved (per tx) | [X] gas |
| Average improvement | [X]% |
| Functions optimized | [N] |
| Logic changes made | [N] |
| All tests pass | ✓ |
| All invariants hold | ✓ |

### 5.3 Estimated Annual Impact

| Scenario | Transactions | Gas Saved | Cost Saved (@ 30 gwei) |
|----------|--------------|-----------|------------------------|
| Low volume (10k txns) | 10,000 | [X]M gas | $[X] |
| Medium volume (100k txns) | 100,000 | [X]M gas | $[X] |
| High volume (1M txns) | 1,000,000 | [X]M gas | $[X] |

## 6. Not Applied (Future Opportunities)

| Opportunity | Estimated Savings | Reason Not Applied | Complexity |
|-------------|-------------------|-------------------|------------|
| [Opportunity 1] | [X] gas | [reason] | [low/med/high] |
| [Opportunity 2] | [X] gas | [reason] | [low/med/high] |
| [Opportunity 3] | [X] gas | [reason] | [low/med/high] |

## 7. Evidence Files

| File | Purpose | Location |
|------|---------|----------|
| Baseline snapshot | Before gas measurements | `reports/.gas-snapshot-before` |
| After snapshot | After gas measurements | `reports/.gas-snapshot-after` |
| Diff report | Change summary | `reports/gas-diff.log` |
| Test results (before) | Pre-optimization tests | `reports/test-before-opt.log` |
| Test results (after) | Post-optimization tests | `reports/test-after-opt.log` |
| Invariant results | Property verification | `reports/invariant-after-opt.log` |
| Coverage report | Code coverage | `reports/coverage.log` |

## 8. Recommendations

### 8.1 Immediate (Applied This Report)

1. ✓ [Optimization 1] - [X] gas saved
2. ✓ [Optimization 2] - [X] gas saved
3. ✓ [Optimization 3] - [X] gas saved

### 8.2 Future Considerations

1. [ ] [Future optimization 1] - Estimated [X] gas
2. [ ] [Future optimization 2] - Estimated [X] gas
3. [ ] [Future optimization 3] - Estimated [X] gas

### 8.3 Trade-offs to Consider

| Optimization | Gas Benefit | Complexity Cost | Recommendation |
|--------------|-------------|-----------------|----------------|
| [opt] | [X] gas | [cost] | Apply/Defer/Reject |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [Date] | [Author] | Initial performance report |
