---
name: gas-opt-contracts
description: Explore and implement Solidity gas optimizations with a priority order focused on minimizing calldata, storage writes, and bounded loops while preserving invariants and clean structure. Use when reducing O(N) behavior, introducing bitmaps/trees, doing bit manipulation for O(1) paths, or restructuring hot paths for orderbook-style contracts.
---

# Gas Optimization for Contracts

## Overview

Optimize complex smart-contract hot paths while preserving correctness, invariants, and auditability.

## Workflow Decision Tree

- If optimizing a hot path or refactoring for gas: follow the Gas Optimization Workflow.
- If changing matching/settlement semantics: require invariants and equivalence tests.
- If introducing bitmaps/trees or cursor logic: follow Patterns & Bit Tricks.
- If the problem is complex (tree structures, bit manipulation, O(1) conversions): follow Deep Optimization Exploration.
- If redesigning storage layout or data structures: read Storage Layout & Data Structure Optimization.
- If focusing on micro‑optimizations: read Micro‑Optimization Checklist.
- If preparing a change summary: use Optimization Evidence Bundle.

## Gas Optimization Workflow

1) **Baseline and measure**
   - Record baseline gas for representative paths.
   - Identify O(N) loops and storage-heavy paths.

2) **Apply priorities in order**
   - Reduce calldata size.
   - Reduce storage writes/touched slots.
   - Compute on the fly; keep derived values in memory.
   - Bound loops and cap work per call.
   - Prefer tree/bitmap structures for depth/indexing.

3) **Preserve invariants**
   - Restate invariants before edits.
   - Ensure all state transitions go through single update paths.

4) **Implement cleanly**
   - Use small, phase-based helpers.
   - Prefer guard clauses over deep nesting.
   - Add minimal comments for non-obvious bit tricks.

5) **Verify + document**
   - Re-measure gas; confirm equivalence tests.
   - Document tradeoffs and safety rationale.

## Deep Optimization Exploration

1) **Map the complexity**
   - Identify each O(N) scan and why it exists (search, ordering, aggregation, cleanup).
   - Write the target O(1)/O(log N) access pattern and the required state to enable it.

2) **Choose a structure**
   - Use bitmaps for existence/next-set-bit jumps.
   - Use prefix-sum trees for depth and claimables.
   - Use monotonic cursors to avoid rescan.

3) **Define minimal state**
   - Track only what enables O(1) navigation (heads, totals, cursors).
   - Avoid extra storage writes; derive values on the fly.

4) **Bound the work**
   - Add explicit caps for ticks/orders/segments.
   - Add settle-first and backlog caps for deferred settlement paths.

5) **Bit manipulation safely**
   - Document each mask/shift and keep helpers small.
   - Add tests for boundary cases (bit 0, bit 255, empty/full words).

## Guardrails (must keep)

- Correctness and invariants first; no semantic drift without approval.
- Bounded loops with explicit caps and fail-fast errors.
- No hidden storage layout changes.
- Keep liquidation or risk-critical paths conservative.

## Required Deliverables

- Baseline vs optimized gas table for hot paths.
- List of invariants/tests affected.
- Clear notes on any new caps, bounds, or storage changes.

## References

- Read `references/optimization_priorities.md` for strict priority order.
- Read `references/patterns_and_tricks.md` for O(1)/bitmap/tree patterns.
- Read `references/optimization_workflow.md` for the exploratory workflow.
- Read `references/deep_optimization_playbook.md` for complex optimization tactics.
- Read `references/storage_layout_optimization.md` for macro storage structure decisions.
- Read `references/micro_optimization_checklist.md` for micro‑level gas tactics.
- Read `references/optimization_evidence.md` for documenting changes.
