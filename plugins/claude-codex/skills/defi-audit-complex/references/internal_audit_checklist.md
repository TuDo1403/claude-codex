# Internal Pre‑Audit Checklist (Detailed)

Use this checklist before any external audit. Goal: reduce surprises and show strong internal diligence.

## Summary table (fill before audit)

| Area | Artifact | Status | Owner |
| --- | --- | --- | --- |
| Scope | Commit hash + contract list |  |  |
| Threat model | Trust assumptions + dependencies |  |  |
| Privilege | Privilege graph + role tests |  |  |
| Asset flows | Max loss bounds worksheet |  |  |
| Invariants | Property/invariant tests |  |  |
| Oracles | Staleness + TWAP tests |  |  |
| Liquidations | Edge cases + regressions |  |  |
| Upgrades | Storage layout + upgrade tests |  |  |
| Reentrancy | CEI + guard tests |  |  |
| DoS/liveness | Bounded loops + backlog tests |  |  |
| Evidence | Report evidence bundle |  |  |
| Ops | Monitoring + incident plan |  |  |

## 1) Scope and documentation

- Lock commit hash and tag scope for review.
- Provide architecture overview and threat model summary.
- Provide a map of contracts and critical flows.

## 2) Trust and privilege review

- Complete the Privilege Graph for all roles.
- Verify timelocks, multisig thresholds, and upgrade delays.
- Ensure emergency controls are bounded and documented.

## 3) Asset flow and max‑loss bounds

- Build asset‑flow map for every fund‑moving path.
- Compute max loss per tx/block/epoch and validate caps.
- Ensure drain paths have mitigations and tests.

## 4) Invariants and property tests

- Define value conservation invariants.
- Define position/health factor invariants.
- Add property tests and fuzzers for invariants.

## 5) Attack‑pattern coverage

- Run through attack pattern checklist (reentrancy, oracle, MEV, liquidation abuse).
- Validate staleness/bounds on all price uses.
- Ensure token quirks (rebasing, fee‑on‑transfer) are handled.

## 6) Oracle and pricing safety

- Verify TWAP windows and staleness checks.
- Check decimal normalization at every price use.
- Simulate oracle manipulation with adversarial tests.

## 7) Liquidation and settlement

- Validate liquidation math and discounts.
- Ensure partial liquidation and edge cases behave safely.
- Verify settlement paths for pending/claimable states.

## 8) Access control and upgrades

- Verify only intended roles can call privileged actions.
- Test upgrade paths and storage layout safety.
- Ensure proxy admin is separate from operator roles.

## 9) Reentrancy and external calls

- Ensure CEI ordering in fund‑moving functions.
- Add reentrancy guard tests on all critical paths.
- Audit external call hooks and callbacks.

## 10) DoS and liveness

- Ensure bounded loops and queue caps.
- Test backlog growth and recovery.
- Simulate keeper failure and emergency paths.

## 11) Gas and failure modes

- Test max‑input gas for worst‑case paths.
- Ensure revert reasons for cap hits are clear and safe.

## 12) Regression tests for findings

- Every issue above Low has a concrete regression test.
- Confirm tests fail before fix and pass after mitigation.

## 13) Operational readiness

- Define monitoring and alert thresholds.
- Have a rollback/pause plan with explicit limits.
- Document incident response flow.

## Final checklist (must be completed)

- [ ] Scope locked and communicated (commit hash, contract list).
- [ ] Trust model and assumptions registry complete.
- [ ] Privilege graph complete with tests for all role‑gated paths.
- [ ] Max loss bounds documented for all fund‑moving paths.
- [ ] Invariants and property tests passing.
- [ ] Oracle safety tests (staleness, bounds, decimals) passing.
- [ ] Liquidation and settlement edge‑case tests passing.
- [ ] Upgrade and storage layout safety verified.
- [ ] Reentrancy protections verified on all fund‑moving paths.
- [ ] DoS/liveness tests for bounded loops and backlog caps passing.
- [ ] Regression tests added for all issues above Low.
- [ ] Evidence bundle prepared (assumptions, privilege graph, max loss, tests).
- [ ] Monitoring and incident response plan documented.
