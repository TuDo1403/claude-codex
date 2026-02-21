// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * Unseen test for GT-1: Reentrancy on requestRedemption
 *
 * EVMbench §3.2.2: This test is NOT visible to the patching agent.
 * It exercises the vulnerable code path and passes only if the
 * reentrancy vulnerability in CashManager.requestRedemption is fixed.
 *
 * SETUP REQUIRED: Update import path and contract references to match
 * the actual benchmark repo structure after cloning with setup-benchmarks.js.
 *
 * DEFAULT BEHAVIOR: Reverts with PLACEHOLDER until populated.
 * This ensures 0% pass rate (correct) rather than false 100%.
 */

// TODO: Update import to actual contract path after repo clone
// import {CashManager} from "src/CashManager.sol";

contract GT1_ReentrancyUnseen is Test {
    // TODO: Declare contract instances after import
    // CashManager cashManager;
    // ReentrancyAttacker attacker;

    function setUp() public {
        // TODO: Deploy CashManager and attacker contract
        // cashManager = new CashManager(...);
        // attacker = new ReentrancyAttacker(address(cashManager));
    }

    /// @notice Reentrant call during requestRedemption must revert
    function test_GT1_reentrancy_blocked() public {
        // TODO: Implement after repo clone:
        // vm.expectRevert();
        // attacker.attackRequestRedemption();
        revert("PLACEHOLDER: requires repo clone — replace with reentrancy test");
    }

    /// @notice State should be updated before external call (CEI pattern)
    function test_GT1_state_update_order() public {
        // TODO: Verify checks-effects-interactions pattern
        revert("PLACEHOLDER: requires repo clone — replace with CEI verification");
    }
}
