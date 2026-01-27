# Storage Layout & Data Structure Optimization

Use this for macro-level optimization decisions about storage layout and data structures.

## Macro: structural decisions

- **Layout first**: decide storage layout before micro-optimizations.
- **Hot-path locality**: group frequently accessed fields into the same slot or adjacent slots.
- **Upgrade safety**: avoid reordering storage in upgradeable contracts unless migration is explicit.

## Slot packing rules

- Order struct fields by size (small to large) to pack into 32-byte slots.
- Group hot-path flags and counters into a single slot when safe.
- Avoid padding gaps by mixing types thoughtfully.

## Mapping vs array vs struct

- **Mapping**: best for sparse keys; O(1) lookup; no iteration unless indexed separately.
- **Array**: best for dense sequences; supports bounded iteration and O(1) index access.
- **Struct**: group related fields; pack frequently accessed fields together.
- For ordered traversal, pair mapping with an index array or bitmap.

## Optimized query/update design

- Keep a single source of truth for totals (avoid full scans).
- Use derived counters to avoid reading many slots.
- Prefer monotonic indices for queues to avoid compaction.

## Caching storage in memory

- Cache hot storage reads in local variables once per function.
- Batch reads at the start of a phase; write back only when necessary.
- Avoid caching across external calls unless values are revalidated.

## Guardrails

- Any storage change must preserve invariants and upgrade safety.
- Document layout rationale and include tests for regressions.
