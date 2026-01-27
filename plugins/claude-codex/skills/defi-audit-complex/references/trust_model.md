# Trust Model (Big-Fund/Financial Protocols)

Define exactly what is trusted and what is not. This drives the audit focus.

## Roles and powers
- **Owner/admin**: upgrades, parameter changes, pausing.
- **Governance**: proposal execution, timelocks, emergency roles.
- **Keepers**: liquidation, settlement, upkeep.
- **Operators**: oracle updates, risk parameter tuning.

## External dependencies
- Oracles and price feeds.
- Bridges and cross-chain messaging.
- Sequencer/rollup availability (if L2).
- External AMMs or lending protocols.

## Assumptions to validate
- Admin does not act maliciously (or constrained by timelock).
- Oracle is honest and updated within bounds.
- Keepers are permissionless or correctly incentivized.
- Emergency controls cannot be abused to freeze funds.

## Trust boundary questions
- What happens if oracle is stale or manipulated?
- What happens if keepers fail to act?
- Can admin change critical parameters without delay?
- Are upgrades secure and rollback-safe?
