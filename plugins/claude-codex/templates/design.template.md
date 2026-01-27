# Architecture Design: [Protocol Name]

> **Gate 1 Artifact** - This document defines the system architecture, storage layout, and external call policy.

## 1. Overview

[High-level architecture description. What contracts exist? How do they interact?]

## 2. Module Boundaries

### 2.1 Contract Diagram

```
┌─────────────────────┐
│   [Main Contract]   │
├─────────────────────┤
│ + deposit()         │
│ + withdraw()        │─────────▶ [External Dep]
│ - _internal()       │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   [Admin Contract]  │
├─────────────────────┤
│ + setFeeRate()      │
│ + pause()           │
└─────────────────────┘
```

### 2.2 Contract Responsibilities

| Contract | Responsibility | External Deps | Upgradeable |
|----------|----------------|---------------|-------------|
| [Core] | Core business logic | [Oracle] | Yes/No |
| [Admin] | Admin functions | None | Yes/No |
| [Library] | Shared utilities | None | N/A |

### 2.3 Interfaces

```solidity
// ICore.sol
interface ICore {
    /// @notice Deposits assets and mints shares
    /// @param amount The amount of assets to deposit
    /// @return shares The number of shares minted
    function deposit(uint256 amount) external returns (uint256 shares);

    /// @notice Withdraws assets by burning shares
    /// @param shares The number of shares to burn
    /// @return amount The amount of assets returned
    function withdraw(uint256 shares) external returns (uint256 amount);

    /// @notice Returns the balance of a user
    /// @param user The user address
    /// @return The share balance
    function balanceOf(address user) external view returns (uint256);
}
```

## 3. Storage Layout

> **CRITICAL:** Document every storage slot for upgrade safety.

### 3.1 [Main Contract] Storage

```
Slot | Offset | Name              | Type       | Size   | Notes
-----|--------|-------------------|------------|--------|------------------
0    | 0      | _owner            | address    | 20B    | Inherited from Ownable
0    | 20     | _paused           | bool       | 1B     | Packed with owner
0    | 21     | _reentrancyLock   | uint8      | 1B     | Packed
1    | 0      | totalAssets       | uint256    | 32B    | Core accounting
2    | 0      | totalShares       | uint256    | 32B    | Core accounting
3    | 0      | feeRate           | uint96     | 12B    | Basis points (max 10000)
3    | 12     | lastHarvest       | uint160    | 20B    | Timestamp, packed
4-53 | -      | __gap             | uint256[]  | 50     | Upgrade safety gap
54   | 0      | balances          | mapping    | -      | User share balances
55   | 0      | allowances        | mapping    | -      | ERC20-style allowances
```

### 3.2 Storage Rules

1. **Packing:** Small values (<32B) packed into single slots when accessed together
2. **Gaps:** 50-slot gap reserved for future upgrades
3. **Mappings:** Always start at clean slot boundaries
4. **Inheritance:** Document inherited storage from parent contracts
5. **Never:** Reorder or remove existing slots during upgrades

### 3.3 Slot Collision Prevention

- Proxy storage (ERC-1967): Slots `0x360894...` (implementation), `0xb53127...` (admin)
- Diamond storage: Namespaced by keccak256 hash
- OpenZeppelin upgradeable: Check Initializable slot

### 3.4 Upgrade Constraints

| Constraint | Requirement |
|------------|-------------|
| New storage | Must append after `__gap`, reduce gap size |
| Type changes | Never change type of existing slot |
| Initializers | Must be idempotent, use `initializer` modifier |
| Version | Bump version number in each upgrade |

## 4. External Call Policy

> **CRITICAL:** Define and enforce all external call rules.

### 4.1 Allowed External Calls

| Target | Function | Type | Guard | Notes |
|--------|----------|------|-------|-------|
| Oracle | `latestRoundData()` | View | None | Read-only, no state change |
| Token | `transfer()` | Write | CEI | After all state updates |
| Token | `transferFrom()` | Write | CEI | After all state updates |
| [Protocol] | [function] | [type] | [guard] | [notes] |

### 4.2 Disallowed Patterns

| Pattern | Reason | Alternative |
|---------|--------|-------------|
| Arbitrary `delegatecall` | Code injection risk | Whitelist targets |
| Unbounded external calls in loops | DoS risk | Batch with limit |
| External calls before state updates | Reentrancy | CEI pattern |
| Raw `call` without checks | Silent failure | SafeCall wrapper |

### 4.3 Reentrancy Protection

| Function | Guard Type | Reason |
|----------|------------|--------|
| `deposit()` | `nonReentrant` | Token callback risk |
| `withdraw()` | `nonReentrant` | Token callback risk |
| `harvest()` | `nonReentrant` | External swap calls |
| `liquidate()` | `nonReentrant` | Token transfers |
| View functions | None | No state changes |

### 4.4 CEI Pattern Compliance

```solidity
function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
    // CHECKS
    require(shares > 0, "InvalidAmount");
    require(balances[msg.sender] >= shares, "InsufficientBalance");

    // EFFECTS
    balances[msg.sender] -= shares;
    totalShares -= shares;
    amount = _calculateAssets(shares);
    totalAssets -= amount;

    // INTERACTIONS
    IERC20(asset).safeTransfer(msg.sender, amount);

    emit Withdraw(msg.sender, shares, amount);
}
```

## 5. Error Model

### 5.1 Custom Errors

```solidity
// Access errors
error Unauthorized(address caller, bytes4 selector);
error NotOwner(address caller);

// Validation errors
error InvalidAmount(uint256 amount);
error InsufficientBalance(address user, uint256 requested, uint256 available);
error ZeroAddress();

// State errors
error ContractPaused();
error NotPaused();
error AlreadyInitialized();

// External errors
error OracleStale(uint256 updatedAt, uint256 threshold);
error InvalidPrice(int256 price);
error TransferFailed(address token, address to, uint256 amount);

// Bound errors
error ExceedsMaxFee(uint96 fee, uint96 maxFee);
error ExceedsMaxSupply(uint256 supply, uint256 maxSupply);
```

### 5.2 Error Categories

| Category | Prefix | Examples |
|----------|--------|----------|
| Access | `Unauthorized*`, `Not*` | `UnauthorizedAdmin`, `NotOwner` |
| Validation | `Invalid*`, `Insufficient*` | `InvalidAmount`, `InsufficientBalance` |
| State | `*Paused`, `*Locked`, `Already*` | `ContractPaused`, `AlreadyInitialized` |
| External | `*Failed`, `*Stale` | `TransferFailed`, `OracleStale` |
| Bounds | `Exceeds*` | `ExceedsMaxFee`, `ExceedsMaxSupply` |

## 6. Event Model

### 6.1 Events

```solidity
// Core events
event Deposit(address indexed user, uint256 assets, uint256 shares);
event Withdraw(address indexed user, uint256 shares, uint256 assets);

// Admin events
event FeeRateUpdated(uint96 oldRate, uint96 newRate);
event Paused(address indexed by);
event Unpaused(address indexed by);

// Upgrade events
event Upgraded(address indexed implementation);
```

### 6.2 Indexing Strategy

| Event | Indexed Params | Use Case |
|-------|----------------|----------|
| Deposit | user | User history lookup |
| Withdraw | user | User history lookup |
| FeeRateUpdated | none | Admin audit trail |
| Paused | by | Emergency audit |
| Upgraded | implementation | Upgrade tracking |

### 6.3 Event Guidelines

- Emit events for ALL state changes
- Index parameters used for filtering (user addresses)
- Include old and new values for parameter changes
- Use descriptive event names (verb + noun)

## 7. Call Graph

### 7.1 External Entry Points

```
User
 │
 ├── deposit(amount)
 │    ├── _validateDeposit(amount)
 │    ├── _calculateShares(amount)
 │    ├── _updateState(shares)
 │    └── token.transferFrom(user, this, amount)
 │
 ├── withdraw(shares)
 │    ├── _validateWithdraw(shares)
 │    ├── _calculateAssets(shares)
 │    ├── _updateState(-shares)
 │    └── token.transfer(user, assets)
 │
 └── [other functions...]

Admin
 │
 ├── setFeeRate(rate)
 │    ├── _checkOwner()
 │    └── _updateFeeRate(rate)
 │
 └── pause()
      ├── _checkOwner()
      └── _setPaused(true)
```

### 7.2 Surface Area Minimization Checklist

- [ ] All admin functions in separate contract
- [ ] View functions separated from mutators
- [ ] Internal helpers not exposed externally
- [ ] Callback surface explicitly limited (no arbitrary callbacks)
- [ ] No public functions that should be external
- [ ] No external functions that should be internal

## 8. Upgrade Strategy

### 8.1 Pattern

| Aspect | Choice | Reason |
|--------|--------|--------|
| Proxy type | UUPS (ERC-1967) | Gas efficient, cleaner |
| Timelock | 48 hours | User protection |
| Process | Two-step | propose → execute |
| Rollback | Manual redeploy | With preserved storage |

### 8.2 Upgrade Safety Checklist

- [ ] Storage gaps maintained (50 slots)
- [ ] No slot reordering from previous version
- [ ] Initializer is idempotent
- [ ] Version number bumped
- [ ] Migration function added (if needed)
- [ ] Tests for upgrade path
- [ ] Timelock delay enforced

### 8.3 UUPS Implementation

```solidity
function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    // Optional: Add additional checks
    require(newImplementation != address(0), ZeroAddress());
    // Timelock is enforced at governance level
}
```

## 9. Security Considerations

### 9.1 Invariants Addressed by Architecture

| Invariant | Architectural Mitigation |
|-----------|--------------------------|
| IC-1 (Conservation) | Single entry/exit points, atomic state updates |
| IA-1 (Access) | Ownable pattern, explicit checks |
| IS-1 (Consistency) | CEI pattern, state machine |
| IB-1 (Bounds) | Input validation at entry points |

### 9.2 Attack Surface Summary

| Entry Point | Risk | Mitigation | Status |
|-------------|------|------------|--------|
| `deposit()` | Medium | ReentrancyGuard, CEI | [ ] |
| `withdraw()` | Medium | ReentrancyGuard, CEI | [ ] |
| `setFeeRate()` | Low | onlyOwner, bounds check | [ ] |
| `upgrade()` | High | UUPS, timelock | [ ] |

## 10. Dependencies

### 10.1 External Libraries

| Library | Version | Purpose | Audit Status |
|---------|---------|---------|--------------|
| OpenZeppelin | 5.0.0 | Access, proxy, utils | Audited |
| Solmate | 6.0.0 | Gas-optimized ERC20 | Audited |
| [Custom] | [ver] | [purpose] | [status] |

### 10.2 External Protocols

| Protocol | Integration | Trust Level | Failure Handling |
|----------|-------------|-------------|------------------|
| Chainlink | Price oracle | Medium | Fallback oracle |
| Uniswap V3 | Liquidity | Low | Slippage protection |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [Date] | [Author] | Initial architecture |
