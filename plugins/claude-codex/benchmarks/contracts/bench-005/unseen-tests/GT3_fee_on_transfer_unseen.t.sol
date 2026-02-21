// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * Unseen test for GT-3: Fee-on-transfer tokens break deposit accounting
 *
 * EVMbench §3.2.2: NOT visible to patching agent.
 * Passes only if deposit accounting handles fee-on-transfer tokens correctly.
 *
 * DEFAULT BEHAVIOR: Reverts with PLACEHOLDER until populated.
 */

contract GT3_FeeOnTransferUnseen is Test {
    function setUp() public {
        // TODO: Deploy ArcadeTreasury with mock fee-on-transfer token
    }

    /// @notice Deposit with fee token must account for actual received amount
    function test_GT3_fee_token_correct_accounting() public {
        // TODO: Deposit fee-on-transfer token, verify recorded amount matches received
        revert("PLACEHOLDER: requires repo clone — replace with fee-on-transfer test");
    }
}
