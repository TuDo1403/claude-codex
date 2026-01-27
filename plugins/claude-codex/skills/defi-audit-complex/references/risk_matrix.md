# Risk Matrix (Complex DeFi)

Use this to rank issues by impact and likelihood and to cover protocol-wide risks.

## Impact levels
- **Critical**: Loss of user funds, total protocol insolvency, governance takeover.
- **High**: Large fund loss, protocol halted, liquidation cascade, stuck funds.
- **Medium**: Partial fund loss, unfair liquidation, serious pricing errors.
- **Low**: Minor loss or operational disruption.

## Likelihood levels
- **Likely**: Exploit path requires no special conditions.
- **Possible**: Requires timing, MEV, or partial control of dependencies.
- **Unlikely**: Requires strong assumptions or rare states.

## Risk categories
- **Accounting**: balance drift, fee misallocation, debt socialization.
- **Oracle**: manipulation, stale feeds, mismatched decimals.
- **Liquidity**: under-collateralized states, bad liquidation rules.
- **Control**: admin abuse, upgrade risk, pausable misuse.
- **External**: bridge/oracle/keeper dependency failures.
- **MEV**: sandwich, back-run liquidation, griefing.

## Example mapping
- Critical x Likely: direct drain via reentrancy in settlement.
- High x Possible: oracle manipulation within update window.
- Medium x Possible: DoS via unbounded loop on order matching.
