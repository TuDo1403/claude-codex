# Fund-Sensitive Audit Guidance

Use this when large funds are at risk or the protocol is systemically important.

## Pinpoint drain paths
- Build an asset-flow map for every function that moves value: mint/burn, transfer, settlement, liquidation, fee sweeps.
- For each path, list preconditions, required privileges, and exact call sequence.
- Note all external calls and reentrancy surfaces in the path.
- Compute a max‑loss bound (per tx / per block / per epoch).

## Mitigation-driven review
- Add caps on value movement where possible.
- Require circuit breakers for abnormal oracle moves, OI spikes, and backlog growth.
- Ensure emergency modes do not introduce new drain paths.

## Security strengthening checklist
- Separate price update and price use; enforce TWAP + staleness checks.
- Protect all fund‑moving code with reentrancy guards and CEI.
- Require timelocked upgrades and role separation for critical actions.
- Add invariants for total value conservation and debt accounting.

## Regression test requirement
- For each drain path identified, write a minimal exploit test.
- Tests should fail before fix and pass after mitigation.
