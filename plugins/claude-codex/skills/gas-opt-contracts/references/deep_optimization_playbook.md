# Deep Optimization Playbook

Use this when exploring hard problems: tree structures, bit manipulation, O(1) conversions, and bounded gas.

## Complexity conversion checklist

- Identify the exact O(N) loop and its trigger conditions.
- Replace scan with:
  - **Bitmap jump** for “next non-empty” and sparse sets.
  - **Prefix-sum tree** for cumulative depth or claimables.
  - **Monotonic cursor** for queues and settlement pointers.
- Add a single source of truth for totals to avoid recompute.

## Tree structure choices

- **Bitmap + linked queue**: fast next-tick discovery with FIFO traversal.
- **RadixSumTree16**: O(log N) prefix sums for depth or claimable shares.
- **Segmented ring buffer**: bounded memory for match segments; require overwrite guards.

## Bit manipulation tactics

- Use `ctz/clz` to find next set bit within a word.
- Store per-bucket flags in `uint256` and index by `word = i >> 8`, `bit = i & 255`.
- Keep masks explicit and wrap with helper functions for clarity.
- Add asserts/tests for cross-word transitions and empty words.

## Bounded gas patterns

- Cap per-call work with `maxTicks`, `maxOrders`, `maxSegments`.
- Use settle-first requirements before adding new segments.
- When caps are reached, revert early with a specific error.

## Maintain cleanliness while optimizing

- Split into phase-based helpers with minimal shared state.
- Keep hot-path helpers small; avoid monolith functions.
- Add a short rationale comment for non-obvious bit or tree logic.

## Invariants to preserve (examples)

- Total depth equals sum tree total.
- Claimable <= total pending.
- FIFO order by queue index is preserved.
- Monotonic cursors never regress.
