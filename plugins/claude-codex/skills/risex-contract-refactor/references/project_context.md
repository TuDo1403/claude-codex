# Project Context (risex-contracts)

Use this as a quick index before touching code. Load the source docs when making decisions.

## Primary design docs (must-read for orderbook refactors)
- `docs/ORDERBOOK_OVERHAUL.md`: target architecture, hook order contract, component map, migration phases.
- `aggregated_match.txt`: aggregate matching rules, invariants, safety gates, and TDD plan.

## Current WIP layout
- `src/wip/flow/PerpetualOrderBookManager.sol`: hook wiring shell.
- `src/wip/engine/OrderBookEngine.sol`: flow orchestration + hooks.
- `src/wip/storage/OrderBookStorage.sol`: storage layout.
- `src/wip/types/OrderBookTypes.sol`: contexts and core types.
- `src/wip/orderbook/book/OrderBook.sol`: book ops.
- `src/wip/match/*`: sequential + aggregate strategies + router.
- `src/wip/components/*`: gateway, risk, fees, settlement, market, events, invariants, cleanup, liquidation, ledger.

## Non-negotiables from docs (summary)
- Preserve behavior unless explicitly approved.
- Keep invariants unchanged; maintain strict hook order.
- Aggregate matching applies to non-liquidation only.
- Liquidation remains per-order and fully settled in-tx.
- Storage refactors must not alter layout without migration approval.

## When to re-open the docs
- Any change to hook ordering, match sequencing, or settlement flow.
- Any change to aggregate matching, STP behavior, or backlog caps.
- Any change that introduces new storage, routing, or externalization.
