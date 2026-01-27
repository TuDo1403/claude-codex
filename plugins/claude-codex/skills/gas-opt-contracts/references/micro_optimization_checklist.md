# Micro‑Optimization Checklist

Use this to squeeze gas from hot paths without breaking clarity or safety.

## Storage and packing

- Group hot‑path fields into the same slot.
- Order struct fields by size to avoid padding.
- Pack flags and small enums into a `uint256` bitfield.

## Reads and writes

- Cache storage reads in memory/local vars once per path.
- Avoid redundant SSTORE by checking for changes when safe.
- Batch writes at the end of a phase when possible.

## Calldata and memory

- Pack calldata into `bytes`/`bytes32` when safe.
- Reuse memory buffers; avoid repeated encoding.

## Arithmetic and branching

- Use `unchecked` only after proving bounds.
- Short‑circuit branches; move rare paths out of loops.
- Prefer small helper functions over monoliths.

## Safety

- Keep invariants intact; add tests for any state change.
- Avoid readability regressions that hinder audits.
