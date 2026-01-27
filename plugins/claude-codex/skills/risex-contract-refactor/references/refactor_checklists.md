# Refactor Checklists (Security, Invariants, Upgradeability)

Use these checklists when refactoring or introducing new components/strategies.

## Refactor safety checklist
- Preserve observable behavior; record explicit approvals for any semantic changes.
- Keep hook order contract intact; document any deviation.
- Maintain storage layout or provide a migration plan with tests.
- Avoid touching economic semantics (fees, funding, settlement) unless approved.
- Centralize state transitions (single update path).
- Keep bounded loops and explicit gas caps.

## Security-first checklist
- Access control: verify all entrypoints and hook externalizations are gated.
- Reentrancy: no external calls before state is consistent; use checks-effects-interactions.
- Oracle/funding snapshots: ensure consistent snapshots per match/segment.
- Arithmetic: validate bounds/overflow; use checked math for critical calculations.
- DoS/gas: bounded loops; circuit breakers for backlogs.
- State sync: ensure claimable/pending/filled stay coherent across all mutations.

## Invariant + formal verification checklist
- Write invariants before refactor; re-run after each phase.
- Prefer property tests for: FIFO, STP, depth identity, claimable sums.
- Add equivalence tests: sequential vs aggregate results after settlement.
- Add negative tests for ring overwrite, backlog caps, settle-first rule.
- Track a minimal invariant set in code comments near mutations.

## Upgradeability & plugin architecture checklist
- Isolate storage in a single layout contract/library.
- Keep routers pure (selection only) and strategies side-effect free.
- Prefer internal hooks first; externalize only after ACL/circuit-breakers exist.
- Add versioned interfaces and explicit upgrade gates.
- Avoid interface calls in hot paths until externalization is approved.

## Audit-friendly artifacts
- Keep a refactor log: mapping of old functions to new components.
- Provide a hook order table and a state transition table.
- Provide invariant list + test references (file + test names).
