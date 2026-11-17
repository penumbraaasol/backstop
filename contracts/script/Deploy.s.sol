// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Backstop} from "../src/Backstop.sol";

/// @notice Deploys Backstop and optionally seeds the treasury.
/// Env: PRIVATE_KEY_DEPLOYER, PRIVATE_KEY_SIGNER, PRIVATE_KEY_RESOLVER, USDC_ADDRESS,
///      MAX_PAYOUT_PER_POLICY, MAX_EXPOSURE_PER_MARKET (whole USDC),
///      REFUND_GRACE_PERIOD_SECONDS, TREASURY_SEED_USDC (whole USDC, 0 to skip).
contract Deploy is Script {
    uint256 constant ONE_USDC = 1e6; // ERC-20 interface decimals on Arc

    function run() external returns (Backstop backstop) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address signer = vm.addr(vm.envUint("PRIVATE_KEY_SIGNER"));
        address resolver = vm.addr(vm.envUint("PRIVATE_KEY_RESOLVER"));
        IERC20 usdc = IERC20(vm.envAddress("USDC_ADDRESS"));

        uint256 maxPayout = vm.envOr("MAX_PAYOUT_PER_POLICY", uint256(1_000)) * ONE_USDC;
        uint256 maxExposure = vm.envOr("MAX_EXPOSURE_PER_MARKET", uint256(5_000)) * ONE_USDC;
        uint64 grace = uint64(vm.envOr("REFUND_GRACE_PERIOD_SECONDS", uint256(1 days)));
        uint256 seed = vm.envOr("TREASURY_SEED_USDC", uint256(0)) * ONE_USDC;

        vm.startBroadcast(deployerPk);
        backstop = new Backstop(usdc, signer, resolver, maxPayout, maxExposure, grace);
        if (seed > 0) {
            usdc.approve(address(backstop), seed);
            backstop.depositTreasury(seed);
        }
        vm.stopBroadcast();

        console2.log("Backstop deployed at", address(backstop));
        console2.log("quoteSigner", signer);
        console2.log("resolver", resolver);
        console2.log("treasury seeded (USDC base units)", seed);
    }
}
