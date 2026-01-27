# Proof Obligations (Pre‑Signoff)

Use this to define what must be proven or tested before sign‑off.

## Required obligations
- Total value conservation across deposits/withdrawals/settlements.
- No unauthorized role can move funds or change critical params.
- Oracle safety: staleness + bounds enforced on all price uses.
- Liquidation math correctness and bounded discounts.
- No unbounded loops on external inputs.

## Evidence types
- Invariant/property tests
- Differential tests vs reference implementation
- Adversarial fuzzing
