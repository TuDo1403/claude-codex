# Tooling & Test Expectations

Use this to drive high‑assurance coverage and regression quality.

## Test coverage map

- Map each critical flow to at least one test: deposit/withdraw, trade, liquidation, settle.
- Include a regression test for each issue above Low.
- Add adversarial tests for reentrancy, oracle drift, MEV ordering.

## Static + dynamic analysis

- Run static analyzers (slither, mythril/medusa as available).
- Use fuzzing/property testing for invariants and edge cases.
- Use differential tests when refactoring logic.

## Invariant testing

- Value conservation and accounting consistency.
- No self‑trade / STP rules (if applicable).
- Monotonic cursors and bounded queues.

## Gas & DoS testing

- Max‑input tests to validate bounded loops.
- Backlog cap enforcement and liveness under load.
