# Threat Model: [Protocol Name]

> **Gate 0 Artifact** - This document defines the security requirements, invariants, and acceptance criteria for the protocol.

## 1. Overview

[Brief description of the protocol/contract being secured. What does it do? What value does it protect?]

## 2. Assets

| Asset | Type | Max Value at Risk | Notes |
|-------|------|-------------------|-------|
| [User deposits] | [ETH/ERC-20] | [$X TVL cap] | [Core value] |
| [Protocol fees] | [ERC-20] | [$X accumulated] | [Treasury] |
| [NFT positions] | [ERC-721] | [$X floor value] | [User positions] |

### 2.1 Asset Criticality

- **Critical (fund loss):** [List assets where loss = direct fund loss]
- **High (protocol damage):** [List assets where loss = protocol reputation/operation damage]
- **Medium (user inconvenience):** [List assets where loss = temporary inconvenience]

## 3. Trust Assumptions

### 3.1 Roles and Powers

| Role | Powers | Trust Level | Constraints |
|------|--------|-------------|-------------|
| Owner/Admin | [Upgrade, pause, set fees] | [High/Medium/Low] | [48h timelock, multisig] |
| Governance | [Parameter changes] | [Medium] | [Voting period, quorum] |
| Keeper | [Liquidate, harvest] | [Low] | [Permissionless] |
| Operator | [Oracle updates] | [Medium] | [Rate limited] |

### 3.2 External Dependencies

| Dependency | Trust Assumption | Failure Mode | Mitigation |
|------------|------------------|--------------|------------|
| [Chainlink ETH/USD] | [Honest within 1%] | [Stale/manipulated] | [Fallback oracle] |
| [Uniswap V3 Pool] | [Liquid, not drained] | [Flash loan attack] | [TWAP, delay] |
| [L2 Sequencer] | [Available] | [Downtime] | [Grace period] |

### 3.3 Trust Boundary Questions

- [ ] What happens if oracle is stale or manipulated?
- [ ] What happens if keepers fail to act?
- [ ] Can admin change critical parameters without delay?
- [ ] Are upgrades secure and rollback-safe?
- [ ] What happens if external protocol is exploited?

## 4. Attacker Classes

| Class | Capabilities | Motivation | Example Attack |
|-------|--------------|------------|----------------|
| External | No privileges, public functions | Profit | Flash loan arbitrage |
| Insider (Keeper) | Keeper role, timing control | Profit/Sabotage | Delayed liquidation |
| Privileged (Admin) | Admin powers | Rug/Exploit | Malicious upgrade |
| MEV Searcher | Transaction ordering | Profit | Sandwich, frontrun |
| Oracle Manipulator | Price feed influence | Profit | TWAP manipulation |

## 5. Attack Surfaces

### 5.1 Entry Points

| Function | Visibility | Risk Level | Attack Vectors |
|----------|------------|------------|----------------|
| `deposit()` | external | Medium | Reentrancy, fee-on-transfer |
| `withdraw()` | external | Medium | Reentrancy, precision loss |
| `flashLoan()` | external | High | Callback attack, price manipulation |
| `liquidate()` | external | High | Sandwich, MEV extraction |
| `setFeeRate()` | external | Low | Unauthorized access |

### 5.2 Attack Vectors

**Reentrancy:**
- [ ] `deposit()` → callback → `withdraw()` race
- [ ] Cross-function reentrancy via shared state
- [ ] Read-only reentrancy in view functions

**Oracle Manipulation:**
- [ ] TWAP manipulation via flash loan
- [ ] Stale oracle data exploitation
- [ ] Multi-oracle arbitrage

**MEV/Economic:**
- [ ] Sandwich attacks on large operations
- [ ] Just-in-time liquidity attacks
- [ ] Liquidation front-running

**DoS:**
- [ ] Unbounded loop gas exhaustion
- [ ] Queue/backlog overflow
- [ ] Block gas limit attacks

## 6. Invariants

> **CRITICAL:** All invariants must have corresponding tests in Gate 2.

### 6.1 Conservation Invariants (IC-*)

| ID | Invariant | Formal Expression |
|----|-----------|-------------------|
| IC-1 | Total value conservation | `sum(balances[u]) + fees == totalDeposits - totalWithdrawals` |
| IC-2 | Reserve covers pending | `reserve >= sum(pendingWithdrawals)` |
| IC-3 | Share/asset ratio | `totalAssets / totalShares` is monotonically non-decreasing |

### 6.2 Consistency Invariants (IS-*)

| ID | Invariant | Formal Expression |
|----|-----------|-------------------|
| IS-1 | Pause state consistency | `paused => !depositsEnabled && !withdrawalsEnabled` |
| IS-2 | Position health | `position.collateral >= position.debt * minCollateralRatio` |
| IS-3 | Liquidation finality | `position.isLiquidated => position.collateral == 0` |

### 6.3 Access Invariants (IA-*)

| ID | Invariant | Formal Expression |
|----|-----------|-------------------|
| IA-1 | Admin restriction | `setFeeRate.caller == owner` |
| IA-2 | Blacklist enforcement | `!blacklisted[user]` for deposits |
| IA-3 | Timelock delay | `upgrade.executeTime >= proposal.time + DELAY` |

### 6.4 Temporal Invariants (IT-*)

| ID | Invariant | Formal Expression |
|----|-----------|-------------------|
| IT-1 | Lockup period | `withdraw.time >= deposit.time + lockupPeriod` |
| IT-2 | Cooldown enforcement | `action.time >= lastAction.time + cooldown` |
| IT-3 | Oracle freshness | `block.timestamp - oracle.updatedAt <= STALENESS_THRESHOLD` |

### 6.5 Bound Invariants (IB-*)

| ID | Invariant | Formal Expression |
|----|-----------|-------------------|
| IB-1 | Fee rate bounds | `0 <= feeRate <= MAX_FEE_RATE` |
| IB-2 | Supply cap | `totalSupply <= MAX_SUPPLY` |
| IB-3 | Slippage bounds | `actualSlippage <= maxSlippage` |

## 7. State Machine

### 7.1 States

| State | Description | Allowed Operations |
|-------|-------------|-------------------|
| ACTIVE | Normal operation | All operations |
| PAUSED | Emergency pause | View only, admin ops |
| DEPRECATED | Migration mode | Withdraw only |
| LIQUIDATING | Position being liquidated | Liquidation, view |

### 7.2 Transitions

```
ACTIVE --[admin.pause()]--> PAUSED
PAUSED --[admin.unpause()]--> ACTIVE
ACTIVE --[admin.deprecate()]--> DEPRECATED
DEPRECATED --[never]--> ACTIVE (irreversible)
ACTIVE --[undercollateralized]--> LIQUIDATING
LIQUIDATING --[liquidation complete]--> ACTIVE
```

### 7.3 Invalid State Combinations

- `paused == true && depositsEnabled == true`
- `totalShares > 0 && totalAssets == 0` (except during initialization)
- `position.isLiquidated == true && position.collateral > 0`

## 8. Acceptance Criteria

### 8.1 Security Acceptance Criteria (AC-SEC-*)

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| AC-SEC-1 | Zero High/Critical Slither findings (or justified) | Slither report |
| AC-SEC-2 | All invariants have passing property tests | Test coverage |
| AC-SEC-3 | Reentrancy guards on all external-call functions | Code review |
| AC-SEC-4 | Oracle staleness check implemented | Code review |
| AC-SEC-5 | Flash loan attack simulation unprofitable | Test simulation |
| AC-SEC-6 | Admin timelock >= 48h on critical functions | Code review |
| AC-SEC-7 | CEI pattern followed in all state-changing functions | Code review |
| AC-SEC-8 | No hardcoded addresses or magic numbers | Code review |

### 8.2 Functional Acceptance Criteria (AC-FUNC-*)

| ID | Criterion | Verification Method |
|----|-----------|---------------------|
| AC-FUNC-1 | Users can deposit and receive correct shares | Unit test |
| AC-FUNC-2 | Users can withdraw and receive correct assets | Unit test |
| AC-FUNC-3 | Liquidations execute within health factor bounds | Integration test |
| AC-FUNC-4 | Fees calculated correctly per specification | Unit test |
| AC-FUNC-5 | Events emitted for all state changes | Event test |

## 9. Risk Matrix

| Risk | Likelihood | Impact | Severity | Mitigation | Status |
|------|------------|--------|----------|------------|--------|
| Reentrancy | Medium | Critical | High | CEI pattern, guards | [ ] Pending |
| Oracle stale | Low | High | Medium | Staleness check | [ ] Pending |
| Flash loan manipulation | Medium | High | High | Same-block restriction | [ ] Pending |
| Admin rug | Low | Critical | Medium | Timelock, multisig | [ ] Pending |
| Sandwich attack | High | Medium | Medium | Slippage protection | [ ] Pending |

## 10. Open Questions

> Resolve all questions before proceeding to Gate 1.

- [ ] Q1: What is the maximum acceptable oracle deviation?
- [ ] Q2: Should keepers be permissioned or permissionless?
- [ ] Q3: What is the minimum timelock delay for upgrades?
- [ ] Q4: What tokens should be supported (fee-on-transfer, rebasing)?

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [Date] | [Author] | Initial threat model |
