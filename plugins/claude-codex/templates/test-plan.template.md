# Test Plan: [Protocol Name]

> **Gate 2 Artifact** - This document maps all invariants to tests and defines attack simulations.

## 1. Overview

**Test Strategy:** TDD with invariant-first approach using Foundry.

**Coverage Targets:**
- Overall line coverage: 90%+
- Overall branch coverage: 85%+
- Critical paths: 100%

**Test Types:**
- Unit tests: Function-level correctness
- Fuzz tests: Random input exploration
- Invariant tests: Property-based verification
- Integration tests: Cross-contract flows
- Attack simulations: Known exploit patterns

## 2. Invariant → Test Mapping

> **CRITICAL:** Every invariant from Gate 0 MUST have at least one corresponding test.

### 2.1 Conservation Invariants (IC-*)

| Invariant | Description | Test Type | Test File | Test Name | Status |
|-----------|-------------|-----------|-----------|-----------|--------|
| IC-1 | sum(balances) == total | Invariant | VaultInvariants.t.sol | invariant_conservation | [ ] Pending |
| IC-2 | reserve >= pending | Invariant | VaultInvariants.t.sol | invariant_reserve | [ ] Pending |
| IC-3 | share ratio monotonic | Invariant | VaultInvariants.t.sol | invariant_shareRatio | [ ] Pending |

### 2.2 Consistency Invariants (IS-*)

| Invariant | Description | Test Type | Test File | Test Name | Status |
|-----------|-------------|-----------|-----------|-----------|--------|
| IS-1 | pause consistency | Unit | VaultCore.t.sol | test_pauseBlocksDeposits | [ ] Pending |
| IS-2 | position health | Invariant | PositionInvariants.t.sol | invariant_health | [ ] Pending |
| IS-3 | liquidation finality | Unit | Liquidation.t.sol | test_liquidationClears | [ ] Pending |

### 2.3 Access Invariants (IA-*)

| Invariant | Description | Test Type | Test File | Test Name | Status |
|-----------|-------------|-----------|-----------|-----------|--------|
| IA-1 | admin restriction | Unit + Fuzz | VaultAdmin.t.sol | test_onlyOwner | [ ] Pending |
| IA-2 | blacklist enforced | Unit | VaultCore.t.sol | test_blacklistBlocks | [ ] Pending |
| IA-3 | timelock delay | Integration | Timelock.t.sol | test_timelockDelay | [ ] Pending |

### 2.4 Temporal Invariants (IT-*)

| Invariant | Description | Test Type | Test File | Test Name | Status |
|-----------|-------------|-----------|-----------|-----------|--------|
| IT-1 | lockup period | Unit | VaultCore.t.sol | test_lockupEnforced | [ ] Pending |
| IT-2 | cooldown | Unit | VaultCore.t.sol | test_cooldownEnforced | [ ] Pending |
| IT-3 | oracle freshness | Unit | Oracle.t.sol | test_staleOracleReverts | [ ] Pending |

### 2.5 Bound Invariants (IB-*)

| Invariant | Description | Test Type | Test File | Test Name | Status |
|-----------|-------------|-----------|-----------|-----------|--------|
| IB-1 | fee bounds | Fuzz | VaultAdmin.t.sol | test_FuzzFeeRate | [ ] Pending |
| IB-2 | supply cap | Invariant | VaultInvariants.t.sol | invariant_supplyCap | [ ] Pending |
| IB-3 | slippage bounds | Fuzz | VaultCore.t.sol | test_FuzzSlippage | [ ] Pending |

## 3. Attack Simulations

> **CRITICAL:** Must include all 6 attack categories.

### 3.1 Reentrancy Tests

| Attack Vector | Test Name | Test File | Technique | Expected Result |
|---------------|-----------|-----------|-----------|-----------------|
| Token callback (ERC-777) | test_ReentrancyDeposit | ReentrancyAttack.t.sol | Malicious token | Revert or state consistent |
| Token callback (ERC-721) | test_ReentrancyNFT | ReentrancyAttack.t.sol | onERC721Received | Revert |
| Cross-function | test_CrossFunctionReentrancy | ReentrancyAttack.t.sol | withdraw in deposit | Revert |
| Read-only | test_ReadOnlyReentrancy | ReentrancyAttack.t.sol | View during callback | Consistent values |

**Test Implementation:**
```solidity
contract MaliciousToken is ERC777 {
    Vault vault;
    bool attacking;

    function tokensReceived(...) external override {
        if (!attacking) {
            attacking = true;
            vault.withdraw(1 ether); // Attempt reentrant call
        }
    }
}

function test_ReentrancyDeposit() public {
    vm.expectRevert("ReentrancyGuard: reentrant call");
    maliciousToken.triggerAttack();
}
```

### 3.2 Fee-on-Transfer / Rebasing Token Tests

| Scenario | Test Name | Test File | Technique | Expected Result |
|----------|-----------|-----------|-----------|-----------------|
| Fee token deposit | test_FeeOnTransferDeposit | TokenEdgeCases.t.sol | Mock 1% fee token | Correct balance accounting |
| Rebasing during tx | test_RebasingDuringWithdraw | TokenEdgeCases.t.sol | Mock rebase token | No loss of funds |
| Balance mismatch | test_BalanceBeforeAfter | TokenEdgeCases.t.sol | Assert deltas | Exact accounting |
| Deflationary | test_DeflationaryToken | TokenEdgeCases.t.sol | Mock burn on transfer | Handle or reject |

**Test Implementation:**
```solidity
function test_FeeOnTransferDeposit() public {
    MockFeeToken feeToken = new MockFeeToken(100); // 1% fee
    uint256 amount = 100 ether;
    uint256 expectedReceived = 99 ether; // After 1% fee

    feeToken.approve(address(vault), amount);
    uint256 sharesBefore = vault.totalShares();

    vault.deposit(amount);

    // Verify accounting matches actual received amount
    assertEq(vault.totalAssets(), expectedReceived);
}
```

### 3.3 Sandwich Attack Tests

| Scenario | Test Name | Test File | Technique | Expected Result |
|----------|-----------|-----------|-----------|-----------------|
| Frontrun large swap | test_SandwichFrontrun | MEVAttack.t.sol | Multi-block sim | Limited profit |
| Backrun extraction | test_SandwichBackrun | MEVAttack.t.sol | Price manipulation | Slippage protected |
| Slippage protection | test_SlippageProtection | MEVAttack.t.sol | Assert bounds | Revert on excess |
| MEV extraction bounds | test_MEVExtractionBounds | MEVAttack.t.sol | Calculate max profit | Below threshold |

**Test Implementation:**
```solidity
function test_SandwichFrontrun() public {
    // Attacker frontrun
    vm.prank(attacker);
    pool.swap(largeAmount, ...);

    // Victim transaction
    vm.prank(victim);
    pool.swap(victimAmount, minOut, ...);

    // Attacker backrun
    vm.prank(attacker);
    pool.swap(reverseAmount, ...);

    // Assert attacker profit is bounded
    uint256 attackerProfit = ...;
    assertLt(attackerProfit, MAX_ACCEPTABLE_MEV);
}
```

### 3.4 Oracle Manipulation Tests

| Scenario | Test Name | Test File | Technique | Expected Result |
|----------|-----------|-----------|-----------|-----------------|
| Stale oracle | test_StaleOracleRevert | OracleAttack.t.sol | Mock old timestamp | Revert |
| Zero price | test_ZeroPriceRevert | OracleAttack.t.sol | Mock zero answer | Revert |
| Flash loan + TWAP | test_FlashLoanOracleManip | OracleAttack.t.sol | Manipulate then call | Unprofitable or revert |
| Oracle disagreement | test_OracleDisagreement | OracleAttack.t.sol | Conflicting oracles | Use median or revert |

**Test Implementation:**
```solidity
function test_StaleOracleRevert() public {
    // Set oracle to be stale
    mockOracle.setUpdatedAt(block.timestamp - 2 hours);

    vm.expectRevert(OracleStale.selector);
    vault.deposit(1 ether);
}

function test_FlashLoanOracleManip() public {
    // Take flash loan
    flashLender.flashLoan(address(this), 1_000_000 ether);

    // In callback: manipulate price, attempt exploit
    // Assert unprofitable
}
```

### 3.5 DoS / Gas Griefing Tests

| Scenario | Test Name | Test File | Technique | Expected Result |
|----------|-----------|-----------|-----------|-----------------|
| Unbounded loop | test_GasGriefingLoop | DoSAttack.t.sol | Max array input | Bounded gas or revert |
| Block gas limit | test_BlockGasLimit | DoSAttack.t.sol | Measure gas | Under block limit |
| Queue overflow | test_QueueOverflow | DoSAttack.t.sol | Max queue size | Capped or handled |
| Dust deposits | test_DustDepositDoS | DoSAttack.t.sol | Many tiny deposits | No state bloat |

**Test Implementation:**
```solidity
function test_BlockGasLimit() public {
    // Measure gas for worst-case operation
    uint256 gasBefore = gasleft();
    vault.processAllPending();
    uint256 gasUsed = gasBefore - gasleft();

    // Assert under block gas limit (30M on mainnet)
    assertLt(gasUsed, 30_000_000);
}
```

### 3.6 Flash Loan Attack Tests

| Scenario | Test Name | Test File | Technique | Expected Result |
|----------|-----------|-----------|-----------|-----------------|
| Price manipulation | test_FlashLoanPriceAttack | FlashLoanAttack.t.sol | Aave flash loan | Unprofitable |
| Governance attack | test_FlashLoanGovernance | FlashLoanAttack.t.sol | Flash borrow + vote | Timelock prevents |
| Collateral inflation | test_FlashLoanCollateral | FlashLoanAttack.t.sol | Inflate + borrow | Same-block check |
| Liquidity attack | test_FlashLoanLiquidity | FlashLoanAttack.t.sol | Drain liquidity | Circuit breaker |

**Test Implementation:**
```solidity
function test_FlashLoanPriceAttack() public {
    // Simulate flash loan attack
    uint256 attackerBalanceBefore = token.balanceOf(attacker);

    // 1. Flash borrow
    // 2. Manipulate price
    // 3. Exploit protocol
    // 4. Repay flash loan

    uint256 attackerBalanceAfter = token.balanceOf(attacker);

    // Attack should be unprofitable after gas
    assertLe(attackerBalanceAfter, attackerBalanceBefore);
}
```

## 4. Test Categories

### 4.1 Unit Tests

| Contract | Test File | Functions | Coverage Target |
|----------|-----------|-----------|-----------------|
| VaultCore | test/unit/VaultCore.t.sol | deposit, withdraw, balanceOf | 100% |
| VaultAdmin | test/unit/VaultAdmin.t.sol | setFee, pause, unpause | 100% |
| OracleLib | test/unit/OracleLib.t.sol | getPrice, validatePrice | 100% |
| [Contract] | [file] | [functions] | [target] |

### 4.2 Fuzz Tests

| Property | Test Name | Test File | Runs | Input Bounds |
|----------|-----------|-----------|------|--------------|
| Deposit any amount | test_FuzzDeposit | VaultFuzz.t.sol | 5000 | 1 wei - 1B tokens |
| Withdraw any shares | test_FuzzWithdraw | VaultFuzz.t.sol | 5000 | 1 - totalShares |
| Fee rate any value | test_FuzzFeeRate | VaultFuzz.t.sol | 5000 | 0 - MAX_FEE |
| [property] | [test] | [file] | [runs] | [bounds] |

### 4.3 Invariant Tests

| Invariant Set | Test File | Handler | Target | Runs |
|---------------|-----------|---------|--------|------|
| Conservation | VaultInvariants.t.sol | VaultHandler | Vault | 5000 |
| Access Control | AccessInvariants.t.sol | AttackerHandler | Vault, Admin | 5000 |
| State Machine | StateInvariants.t.sol | StateHandler | Vault | 5000 |

### 4.4 Integration Tests

| Scenario | Test File | Contracts | Setup |
|----------|-----------|-----------|-------|
| Full deposit/withdraw flow | Integration.t.sol | Vault, Token | Deploy fresh |
| Liquidation flow | Integration.t.sol | Vault, Oracle | Fork mainnet |
| Upgrade flow | Upgrade.t.sol | Proxy, Impl | Deploy + upgrade |
| [scenario] | [file] | [contracts] | [setup] |

## 5. Coverage Targets

| Module | Line Target | Branch Target | Critical Paths |
|--------|-------------|---------------|----------------|
| VaultCore | 95% | 90% | deposit, withdraw |
| VaultAdmin | 90% | 85% | setFee, pause |
| OracleLib | 100% | 100% | getPrice |
| [Module] | [%] | [%] | [paths] |
| **Overall** | **90%** | **85%** | - |

## 6. Test Commands

```bash
# Run all tests
forge test -vvv

# Run with specific fuzz runs
forge test --fuzz-runs 5000 -vvv

# Run invariant tests only
forge test --match-test "invariant_" -vvv --fuzz-runs 5000

# Run attack simulations
forge test --match-contract "Attack" -vvv

# Run specific test file
forge test --match-path "test/unit/VaultCore.t.sol" -vvv

# Generate coverage report
forge coverage --report lcov

# Generate gas report
forge test --gas-report
```

## 7. Test File Structure

```
test/
├── unit/
│   ├── VaultCore.t.sol        # Core function tests
│   ├── VaultAdmin.t.sol       # Admin function tests
│   └── OracleLib.t.sol        # Library tests
├── fuzz/
│   ├── VaultFuzz.t.sol        # Fuzz tests
│   └── OracleFuzz.t.sol       # Oracle fuzz tests
├── invariant/
│   ├── VaultInvariants.t.sol  # Conservation, consistency
│   ├── AccessInvariants.t.sol # Access control
│   └── handlers/
│       ├── VaultHandler.sol   # Vault action handler
│       └── AttackerHandler.sol # Attacker simulation
├── integration/
│   ├── Integration.t.sol      # Full flow tests
│   └── Upgrade.t.sol          # Upgrade tests
├── attack/
│   ├── ReentrancyAttack.t.sol # Reentrancy simulations
│   ├── OracleAttack.t.sol     # Oracle manipulation
│   ├── MEVAttack.t.sol        # Sandwich, frontrun
│   ├── DoSAttack.t.sol        # Gas griefing, DoS
│   ├── FlashLoanAttack.t.sol  # Flash loan vectors
│   └── TokenEdgeCases.t.sol   # Fee-on-transfer, rebasing
├── mocks/
│   ├── MockERC777.sol         # Callback token
│   ├── MockFeeToken.sol       # Fee-on-transfer
│   ├── MockRebaseToken.sol    # Rebasing token
│   └── MockOracle.sol         # Controllable oracle
└── utils/
    ├── TestBase.sol           # Common setup
    └── Assertions.sol         # Custom assertions
```

## 8. Test Fixtures

### 8.1 Base Test Contract

```solidity
// test/utils/TestBase.sol
abstract contract TestBase is Test {
    Vault public vault;
    MockToken public token;
    MockOracle public oracle;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public attacker = makeAddr("attacker");

    uint256 public constant INITIAL_BALANCE = 1000 ether;

    function setUp() public virtual {
        // Deploy contracts
        vm.startPrank(owner);
        token = new MockToken();
        oracle = new MockOracle();
        vault = new Vault(address(token), address(oracle));
        vm.stopPrank();

        // Fund test accounts
        token.mint(alice, INITIAL_BALANCE);
        token.mint(bob, INITIAL_BALANCE);
        token.mint(attacker, INITIAL_BALANCE);

        // Approve vault
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }
}
```

### 8.2 Handler Contract for Invariant Tests

```solidity
// test/invariant/handlers/VaultHandler.sol
contract VaultHandler is Test {
    Vault public vault;
    MockToken public token;
    address[] public actors;

    constructor(Vault _vault, MockToken _token) {
        vault = _vault;
        token = _token;
        actors.push(makeAddr("actor1"));
        actors.push(makeAddr("actor2"));
        actors.push(makeAddr("actor3"));

        // Fund actors
        for (uint i = 0; i < actors.length; i++) {
            token.mint(actors[i], 1000 ether);
            vm.prank(actors[i]);
            token.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1, token.balanceOf(actor));

        vm.prank(actor);
        vault.deposit(amount);
    }

    function withdraw(uint256 actorSeed, uint256 shares) public {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = vault.balanceOf(actor);
        if (balance == 0) return;
        shares = bound(shares, 1, balance);

        vm.prank(actor);
        vault.withdraw(shares);
    }
}
```

## 9. Pending Items

- [ ] All invariants from Gate 0 mapped to tests
- [ ] All 6 attack simulation categories implemented
- [ ] Coverage targets defined and achievable
- [ ] Test file structure created
- [ ] Mock contracts implemented
- [ ] Handler contracts for invariant tests

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [Date] | [Author] | Initial test plan |
