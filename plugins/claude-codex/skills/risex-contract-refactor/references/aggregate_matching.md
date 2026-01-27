# Aggregate Matching: Invariants & Gates (Quick Reference)

Use this as a checklist for any aggregate matching edits. Open `aggregated_match.txt` for full rationale.

## Core commitments
- Aggregate matching only for non-liquidation.
- Liquidation stays per-order and fully settled in-transaction.
- Preserve FIFO price-time priority and strict STP semantics.

## Circuit breaker rules
- If backlog cap is hit: halt matching; allow only settlement, add collateral, cancel.
- Reduce-only blocked while pending settlement unless safe effective-position check exists.

## Settlement cursor immutability
- `segmentHead`, `segmentOffset`, `settleOrderIndex` are monotonic.
- No admin/emergency reset without explicit migration.

## Settle-first rule
- Each match call must settle at least M units or K segments before adding new segments; otherwise revert.

## Single source of truth for per-order state
- Define `remaining/unmatched`, `claimable`, `claimed` clearly.
- Tree leaves map to unmatched only; all state transitions go through a single update path.

## Invariants to enforce/tests to keep
- `depth(tick) == totalPending(tick) - totalClaimable(tick)`.
- `totalClaimable(tick) <= totalPending(tick)`.
- FIFO fill strictly by `queueIndex`.
- Sum of per-order claimables equals `totalClaimable`.
- No self fills unless STP rule triggers cancellation/expire.
- After full settlement, balances/positions match current per-order behavior.

## Safety fixes (must preserve)
- Ring-buffer overwrite: require stale slot fully claimable before overwrite.
- Lazy head popping: advance head before STP checks and settlement boundaries.
- OI/funding risk: use conservative bounds at match; exact at settlement; store funding snapshot per segment.
- Liquidation with pending claimables: force-settle (bounded) or revert.
- Expiry/cancel: only affect unfilled remainder; claimable portion stays.
