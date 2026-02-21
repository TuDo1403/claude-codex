// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * Unseen test for GT-2: Rounding error in share price calculation
 *
 * EVMbench §3.2.2: NOT visible to patching agent.
 * Passes only if share price calculation handles rounding correctly.
 *
 * DEFAULT BEHAVIOR: Reverts with PLACEHOLDER until populated.
 */

contract GT2_RoundingErrorUnseen is Test {
    function setUp() public {
        // TODO: Deploy InvestmentManager after repo clone
    }

    /// @notice Last withdrawer must not receive excess shares from rounding
    function test_GT2_no_rounding_exploit() public {
        // TODO: Multiple deposits/withdrawals, verify pool not drained by rounding
        revert("PLACEHOLDER: requires repo clone — replace with rounding test");
    }
}
