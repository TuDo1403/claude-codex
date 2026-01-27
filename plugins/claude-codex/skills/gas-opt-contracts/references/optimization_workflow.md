# Gas Optimization Workflow (Exploratory)

Use this workflow to explore complex optimizations safely.

## 1) Baseline

- Identify target functions and hot paths.
- Record baseline gas for representative scenarios.

## 2) Classify cost sources

- Calldata, storage writes, storage reads, branching, loops.
- Record where O(N) behavior shows up and why.

## 3) Choose tactics (in priority order)

- Reduce calldata size.
- Reduce storage writes.
- Compute on the fly.
- Bound loops or re-index.
- Use trees/bitmaps for depth and queue traversal.

## 4) Validate invariants

- Restate invariants before changing logic.
- Ensure state transitions go through single update paths.

## 5) Implement with guardrails

- Keep functions small and phase-based.
- Add caps and error paths for bounded loops.
- Avoid hidden storage layout changes.

## 6) Re-measure

- Compare baseline vs optimized results.
- Confirm identical semantics (equivalence tests).

## 7) Document

- Add a brief optimization note in code or changelog.
- Note any tradeoffs and why they are safe.
