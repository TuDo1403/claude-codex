# Notable DeFi Attack Patterns (Checklist)

Use this as a checklist, not a history lesson. Focus on mechanisms.

## Core patterns

- Reentrancy in settlement, fee transfer, or callback hooks.
- Oracle manipulation (spot price, TWAP, stale or mismatched decimals).
- Flash-loan amplification of price or debt shifts.
- Liquidation abuse (self-liquidation, bad discounts, partial settle).
- Sandwich/MEV ordering of price updates or auctions.
- Under-collateralized mint/burn due to rounding or timing.
- Cross-contract accounting drift (double-counting or missing debt).
- Upgradeability misuse (storage collisions, untrusted implementation).
- Permission bypass (role misconfig, proxy admin key leaks).
- DoS via unbounded loops or queue growth.

## Complex-protocol patterns

- Asymmetric rounding across deposit/withdraw paths.
- Interest/funding snapshots taken at inconsistent times.
- Claimable vs pending drift in deferred settlement models.
- Asset rate mismatch between internal and external accounting.
- Token with non-standard ERC20 behavior (fee-on-transfer, rebasing).

## Chained exploit reasoning (when multiple issues exist)

- If you find N>1 issues, attempt to compose them into an end-to-end attack chain.
- Identify the enabling precondition, the pivot, and the drain/impact step.
- Map the full chain to the closest known pattern(s) above and document the linkage.

## Mitigation checklist

- Enforce reentrancy guards and checks-effects-interactions.
- Use oracle sanity bounds and staleness checks.
- Bound loops and cap queue sizes.
- Add invariant tests for total value conservation.
- Require timelocks and role separation for upgrades.
