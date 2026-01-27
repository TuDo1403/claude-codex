---
name: risex-contract-refactor
description: Refactor large Solidity contracts in risex-contracts with security-first, audit-friendly, invariant-driven workflows and upgrade-safe, plugin-ready architecture. Use when decomposing OrdersManager/OrderBook flows, introducing matching strategies or hooks, preserving economic semantics, or writing invariants/formal checks for aggregate matching or orderbook refactors.
---

# Risex Contract Refactor

## Overview

Enable safe, behavior-preserving refactors of large orderbook contracts with explicit invariants, strict hook ordering, and upgrade-safe componentization.

## Workflow Decision Tree

- If the task changes match/settlement flow or hook ordering: read `references/project_context.md`, then open `docs/ORDERBOOK_OVERHAUL.md`.
- If the task touches aggregate matching: read `references/aggregate_matching.md`, then open `aggregated_match.txt`.
- If the task introduces a new component/strategy/router: use the Core Refactor Workflow and the Upgradeability checklist.
- If the task is about tests or formal verification: use the Invariants & Verification Workflow.

## Core Refactor Workflow (behavior-preserving)

1) **Scope + constraints**
   - Identify exact files/functions being refactored and freeze behavior.
   - List non-goals explicitly (fees, funding, settlement semantics).
   - Open the project docs as needed for hook order and component map.

2) **Behavior freeze + test mapping**
   - Map old functions to new components (entrypoint -> hooks -> strategy -> settlement).
   - Add or locate golden tests for equivalence before changing behavior.
   - Ensure any storage changes have a migration plan or are avoided.

3) **Decompose with patterns**
   - Use Engine (flow), Strategy (matching), Router (selection), Component (policy) roles.
   - Keep state transitions centralized and route-only logic in routers.
   - Prefer internal library/component calls before externalization.

4) **Implement with invariants first**
   - Write or update invariants before modifying matching logic.
   - Enforce single update paths for claimable/pending/filled mutations.
   - Keep bounded loops and explicit gas caps.

5) **Verify + secure**
   - Run equivalence tests (sequential vs aggregate after settlement).
   - Re-run invariants and edge cases (STP, expiry, ring wrap).
   - Validate access control and reentrancy boundaries.

6) **Audit artifacts**
   - Produce a refactor log and hook order table.
   - Record invariant list with test references.

## Invariants & Verification Workflow

- Define invariants in terms of storage (depth identity, claimable sums, FIFO order).
- Add property tests for STP and settlement idempotence.
- Add negative tests for backlog caps, ring overwrite, and settle-first rule.
- Ensure liquidation path remains per-order and fully settled in-transaction.

## Design Pattern Guardrails (refactor guru)

- Use composition over inheritance; avoid deep class trees.
- Keep strategies interchangeable; keep routers pure (selection only).
- Keep storage in a single layout contract/library for upgrade safety.
- Avoid interface calls in hot paths until externalization is approved.

## Security-First Guardrails

- Enforce strict hook order; never insert external calls before state is consistent.
- Gate external hooks with ACL + circuit breaker.
- Snapshot oracle/funding consistently per match/segment.
- Prevent DoS with bounded loops and backlog caps.

## References

- Read `references/project_context.md` for local file map and non-negotiables.
- Read `references/aggregate_matching.md` for aggregate matching invariants and gates.
- Read `references/refactor_checklists.md` for security, invariants, and upgradeability checklists.
