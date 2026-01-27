# Industry-Standard Audit Checklist

Use this as a breadth checklist to ensure coverage across common attack vectors.

## Access control & governance
- Role separation, least privilege, timelocks, emergency controls.
- Proxy admin security, upgrade delays, rollback path.

## Reentrancy & external calls
- CEI ordering, reentrancy guards on fund‑moving paths.
- External callbacks or hooks audited and gated.

## Oracle & pricing
- Staleness checks, bounds, TWAP, decimal handling.
- Sequencer/rollup downtime handling (if L2).

## Accounting correctness
- Total value conservation, debt and fee accounting.
- Rounding and precision symmetry across mint/burn/withdraw.

## Liquidity & liquidation
- Correct health factor math, discounts, partial liquidation.
- Avoid perverse incentives or self‑liquidation abuse.

## MEV & ordering
- Sandwichability, auction manipulation, liquidation ordering.
- Front‑run protection for sensitive actions when needed.

## DoS & liveness
- Bounded loops, queue caps, backlog handling.
- Keeper failure and emergency recovery paths.

## Token behavior
- Fee‑on‑transfer, rebasing, non‑standard ERC20.
- Safe handling of approvals, decimals, and transfer failures.
