# Complex DeFi Audit Workflow

Use this workflow for big-fund, financial, and complex protocol audits.

## 1) Scope, trust model, and assumptions

- Identify assets at risk, privileged roles, and upgrade paths.
- List external dependencies: oracles, bridges, keepers, sequencers, L2s.
- Define trust boundaries and record assumptions.

## 2) Privilege graph + max loss bounds

- Map all role‑gated paths and upgrade surfaces.
- Build max‑loss bounds per fund‑moving path.

## 3) Risk matrix and attack surface

- Map components to risks by impact and likelihood.
- Enumerate entrypoints, callbacks, hooks, and external calls.
- Consult local attack repos and read each listed repo at least once for pattern matching.

## 4) Invariants and safety properties

- Write invariants for balances, positions, liquidity, and accounting totals.
- Ensure invariants cover normal ops and failure modes.

## 5) Review high‑risk paths

- Liquidation, settlement, fee accounting, price updates, rebalancing.
- Emergency paths and admin actions.

## 6) Adversarial testing

- Simulate reentrancy, oracle manipulation, DoS, and MEV ordering.
- Test with extreme values, partial fills, and edge cases.

## 7) Report, mitigations, and evidence

- Provide severity, exploit path, and fix guidance.
- Add regression tests for each issue above Low.
- Record assumptions, max‑loss bounds, and operational controls.
