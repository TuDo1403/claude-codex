# Gas Optimization Priorities (Order of Operations)

Use this when exploring complex optimizations. Keep the priority order unless an explicit tradeoff is approved.

## Priority order

1) **Small calldata size**

- Prefer tightly packed inputs; avoid redundant args.
- Use `bytes`/`bytes32` for packed inputs when safe.
- Avoid repeated parameters in internal calls.

1) **Small storage writes**

- Minimize SSTORE count and touched slots.
- Prefer single-write batching and bit-packing.
- Avoid writes on revert paths or noop actions.

1) **Compute on the fly**

- Recompute from inputs/derived values rather than storing.
- Cache in memory only within a transaction.

1) **Bounded loops**

- Cap iterations with explicit limits.
- Replace unbounded scans with indexed or batched flows.

1) **Tree structures**

- Prefer prefix-sum trees/bitmaps for orderbook depth or queues.
- Ensure monotonic cursors and O(log N) or O(1) paths.

## Never trade away

- Correctness, safety, and invariants.
- Hook order and settlement semantics.
- Upgrade-safe storage layout.
