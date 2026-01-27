# Patterns & Bit Tricks (Use With Cleanliness)

Keep code readable; prefer small, local helpers over giant functions.

## Replace O(N) with O(1) or O(log N)

- **Running totals**: maintain `total` + `delta` updates instead of full scans.
- **Prefix sums**: use a sum tree (RadixSumTree16) for queue depth and order claims.
- **Bitmaps**: track non-empty ticks or buckets with bit ops; use `ctz`/`clz` to jump.
- **Monotonic cursors**: advance head/tail indices; never reset without migration.
- **Memoized bounds**: store max/min bounds per epoch or segment to avoid scans.

## Bounded loop patterns

- `for (i = 0; i < limit && cond; ++i)`; early stop on exhaustion.
- Use `maxTicks`, `maxOrders`, `maxSegments` to cap work.
- Fail fast when caps are reached; emit a diagnostic error.

## Bit manipulation rules

- Use masks for small flags (e.g., `uint256 flags`).
- Pack booleans and small enums into one slot.
- Keep shift ranges explicit and documented; avoid magic numbers.
- Prefer inline `unchecked` only after proofs.

## Micro-optimization basics

- **Slot packing**: order struct fields by size to minimize slots; group hot-path fields together.
- **SLOAD reduction**: cache storage reads in memory/local variables once per path.
- **Write minimization**: avoid redundant writes; check for value changes before SSTORE when safe.
- **Tight types**: use `uint64/uint128` when bounds are known and packed.
- **Branch control**: keep hot-path branches predictable; move rare branches out of loops.

## Branch reduction

- Merge conditions when safe to reduce branching.
- Use lookup tables for small state machines.
- Keep revert paths short and early.

## Function size & structure

- Split large functions into helpers aligned to phases.
- Keep per-phase helpers pure or view when possible.
- Avoid deep nesting by using guard clauses.

## Cleanliness requirements

- Every optimization must cite the baseline cost and the expected win.
- Add a short rationale comment for non-obvious bit tricks.
- Add tests or invariants when changing state transitions.
