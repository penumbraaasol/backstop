// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Backstop} from "../src/Backstop.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract BackstopTest is Test {
    uint256 constant USDC = 1e6;
    string constant SYMBOL = "GEMI-BTC-TEST-HI100000";
    bytes32 marketId = keccak256(bytes(SYMBOL));

    MockUSDC usdc;
    Backstop backstop;

    address owner = address(this);
    uint256 signerPk = 0xA11CE;
    address signer;
    address resolver = makeAddr("resolver");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 nonceCounter = 1;

    function setUp() public {
        vm.warp(1_763_000_000);
        signer = vm.addr(signerPk);
        usdc = new MockUSDC();
        backstop = new Backstop(usdc, signer, resolver, 1_000 * USDC, 5_000 * USDC, 1 days);

        usdc.mint(owner, 10_000 * USDC);
        usdc.approve(address(backstop), type(uint256).max);
        backstop.depositTreasury(2_000 * USDC);

        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            usdc.mint(u, 1_000 * USDC);
            vm.prank(u);
            usdc.approve(address(backstop), type(uint256).max);
        }
    }

    // --- helpers -----------------------------------------------------------

    function _quote(address buyer, uint8 outcome, uint256 payout, uint256 premium)
        internal
        returns (Backstop.Quote memory q)
    {
        q = Backstop.Quote({
            buyer: buyer,
            marketId: marketId,
            outcome: outcome,
            payout: payout,
            premium: premium,
            quoteExpiry: uint64(block.timestamp + 60),
            resolveBy: uint64(block.timestamp + 1 hours),
            nonce: nonceCounter++
        });
    }

    function _sign(Backstop.Quote memory q, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, backstop.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _buy(address buyer, uint8 outcome, uint256 payout, uint256 premium) internal returns (uint256) {
        Backstop.Quote memory q = _quote(buyer, outcome, payout, premium);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(buyer);
        return backstop.buyPolicy(q, sig, SYMBOL);
    }

    // --- happy paths -------------------------------------------------------

    function test_BuyLocksLiquidityAndPullsPremium() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        assertEq(id, 1);
        assertEq(usdc.balanceOf(alice), 970 * USDC);
        assertEq(usdc.balanceOf(address(backstop)), 2_030 * USDC);
        assertEq(backstop.lockedLiquidity(), 100 * USDC);
        assertEq(backstop.marketExposure(marketId), 100 * USDC);
        assertEq(backstop.freeLiquidity(), 1_930 * USDC);

        Backstop.Policy memory p = backstop.getPolicy(id);
        assertEq(p.buyer, alice);
        assertEq(uint8(p.status), uint8(Backstop.Status.Active));
        assertEq(p.payout, 100 * USDC);
        assertEq(p.premium, 30 * USDC);
    }

    function test_EmitsPolicyPurchased() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.expectEmit(true, true, true, true);
        emit Backstop.PolicyPurchased(1, alice, marketId, SYMBOL, 1, 100 * USDC, 30 * USDC);
        vm.prank(alice);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_HappyPathPayout() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 1);

        vm.prank(bob); // anyone can settle
        backstop.settle(id);

        assertEq(usdc.balanceOf(alice), 1_070 * USDC); // -30 premium +100 payout
        assertEq(uint8(backstop.getPolicy(id).status), uint8(Backstop.Status.PaidOut));
        assertEq(backstop.lockedLiquidity(), 0);
        assertEq(backstop.marketExposure(marketId), 0);
        assertEq(usdc.balanceOf(address(backstop)), 1_930 * USDC);
    }

    function test_LosingPolicyExpires() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 2);
        backstop.settle(id);

        assertEq(usdc.balanceOf(alice), 970 * USDC);
        assertEq(uint8(backstop.getPolicy(id).status), uint8(Backstop.Status.Expired));
        assertEq(backstop.lockedLiquidity(), 0);
        assertEq(backstop.freeLiquidity(), 2_030 * USDC); // premium kept as revenue
    }

    function test_NoOutcomeCoverPaysOnNo() public {
        uint256 id = _buy(alice, 2, 100 * USDC, 75 * USDC);
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 2);
        backstop.settle(id);
        assertEq(uint8(backstop.getPolicy(id).status), uint8(Backstop.Status.PaidOut));
        assertEq(usdc.balanceOf(alice), 1_025 * USDC);
    }

    function test_CannotSettleTwice() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 1);
        backstop.settle(id);
        vm.expectRevert(Backstop.PolicyNotActive.selector);
        backstop.settle(id);
    }

    function test_CannotSettleBeforeResolution() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.expectRevert(Backstop.MarketNotResolved.selector);
        backstop.settle(id);
    }

    // --- quote validation --------------------------------------------------

    function test_RevertBadSignature() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, 0xB0B);
        vm.prank(alice);
        vm.expectRevert(Backstop.InvalidSignature.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertTamperedQuote() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        q.premium = 1 * USDC; // buyer tries to lower the premium
        vm.prank(alice);
        vm.expectRevert(Backstop.InvalidSignature.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertExpiredQuote() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.warp(q.quoteExpiry + 1);
        vm.prank(alice);
        vm.expectRevert(Backstop.QuoteExpired.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertReplayedNonce() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.startPrank(alice);
        backstop.buyPolicy(q, sig, SYMBOL);
        vm.expectRevert(Backstop.NonceUsed.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
        vm.stopPrank();
    }

    function test_RevertWrongSender() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bob);
        vm.expectRevert(Backstop.NotBuyer.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertSymbolMismatch() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(Backstop.SymbolMismatch.selector);
        backstop.buyPolicy(q, sig, "SOME-OTHER-SYMBOL");
    }

    function test_RevertInvalidOutcome() public {
        Backstop.Quote memory q = _quote(alice, 3, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(Backstop.InvalidOutcome.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertPremiumNotBelowPayout() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 100 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(Backstop.InvalidAmounts.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertBuyOnResolvedMarket() public {
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 1);
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(Backstop.MarketAlreadyResolved.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    // --- caps and liquidity ------------------------------------------------

    function test_RevertPayoutCap() public {
        Backstop.Quote memory q = _quote(alice, 1, 1_001 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(Backstop.PayoutCapExceeded.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertMarketExposureCap() public {
        backstop.setCaps(1_000 * USDC, 150 * USDC);
        _buy(alice, 1, 100 * USDC, 30 * USDC);
        Backstop.Quote memory q = _quote(bob, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bob);
        vm.expectRevert(Backstop.MarketCapExceeded.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    function test_RevertInsufficientLiquidity() public {
        backstop.withdrawTreasury(owner, 1_950 * USDC); // 50 USDC free
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(Backstop.InsufficientLiquidity.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    // --- cancel and refunds ------------------------------------------------

    function test_CancelAndRefund() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.prank(resolver);
        backstop.cancelAndRefund(id);
        assertEq(usdc.balanceOf(alice), 1_000 * USDC);
        assertEq(uint8(backstop.getPolicy(id).status), uint8(Backstop.Status.Refunded));
        assertEq(backstop.lockedLiquidity(), 0);
        assertEq(backstop.marketExposure(marketId), 0);
    }

    function test_CancelOnlyResolver() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.prank(alice);
        vm.expectRevert(Backstop.NotResolver.selector);
        backstop.cancelAndRefund(id);
    }

    function test_ResolveOnlyResolverAndOnce() public {
        vm.prank(alice);
        vm.expectRevert(Backstop.NotResolver.selector);
        backstop.resolveMarket(marketId, 1);

        vm.startPrank(resolver);
        backstop.resolveMarket(marketId, 1);
        vm.expectRevert(Backstop.MarketAlreadyResolved.selector);
        backstop.resolveMarket(marketId, 2);
        vm.expectRevert(Backstop.InvalidOutcome.selector);
        backstop.resolveMarket(keccak256("other"), 0);
        vm.stopPrank();
    }

    function test_TimeoutRefund() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        Backstop.Policy memory p = backstop.getPolicy(id);

        vm.warp(uint256(p.resolveBy) + 1 days); // exactly at the boundary: not yet
        vm.prank(alice);
        vm.expectRevert(Backstop.RefundNotYetAvailable.selector);
        backstop.claimRefund(id);

        vm.warp(uint256(p.resolveBy) + 1 days + 1);
        vm.prank(bob);
        vm.expectRevert(Backstop.NotBuyer.selector);
        backstop.claimRefund(id);

        vm.prank(alice);
        backstop.claimRefund(id);
        assertEq(usdc.balanceOf(alice), 1_000 * USDC);
        assertEq(uint8(backstop.getPolicy(id).status), uint8(Backstop.Status.Refunded));
        assertEq(backstop.lockedLiquidity(), 0);
    }

    function test_NoTimeoutRefundAfterResolution() public {
        uint256 id = _buy(alice, 1, 100 * USDC, 30 * USDC);
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 2);
        vm.warp(block.timestamp + 10 days);
        vm.prank(alice);
        vm.expectRevert(Backstop.MarketAlreadyResolved.selector);
        backstop.claimRefund(id);
    }

    // --- treasury ----------------------------------------------------------

    function test_WithdrawCannotTouchLockedFunds() public {
        _buy(alice, 1, 100 * USDC, 30 * USDC);
        // balance 2030, locked 100 -> free 1930
        vm.expectRevert(Backstop.InsufficientLiquidity.selector);
        backstop.withdrawTreasury(owner, 1_931 * USDC);

        backstop.withdrawTreasury(owner, 1_930 * USDC);
        assertEq(usdc.balanceOf(address(backstop)), 100 * USDC);
        assertEq(backstop.freeLiquidity(), 0);

        // the open policy can still be paid in full
        vm.prank(resolver);
        backstop.resolveMarket(marketId, 1);
        backstop.settle(1);
        assertEq(usdc.balanceOf(alice), 1_070 * USDC);
    }

    function test_OwnerOnlyAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        backstop.withdrawTreasury(alice, 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        backstop.setQuoteSigner(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        backstop.setResolver(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        backstop.setCaps(1, 1);
        vm.stopPrank();
    }

    function test_RotatedSignerInvalidatesOldQuotes() public {
        Backstop.Quote memory q = _quote(alice, 1, 100 * USDC, 30 * USDC);
        bytes memory sig = _sign(q, signerPk);
        backstop.setQuoteSigner(makeAddr("newSigner"));
        vm.prank(alice);
        vm.expectRevert(Backstop.InvalidSignature.selector);
        backstop.buyPolicy(q, sig, SYMBOL);
    }

    // --- invariant-style fuzz ----------------------------------------------

    function testFuzz_LockedNeverExceedsBalance(uint96 payout, uint96 premium, bool win) public {
        uint256 pay = bound(uint256(payout), 2, 1_000 * USDC);
        uint256 prem = bound(uint256(premium), 1, pay - 1);
        uint256 id = _buy(alice, 1, pay, prem);
        assertLe(backstop.lockedLiquidity(), usdc.balanceOf(address(backstop)));
        vm.prank(resolver);
        backstop.resolveMarket(marketId, win ? 1 : 2);
        backstop.settle(id);
        assertEq(backstop.lockedLiquidity(), 0);
        assertEq(usdc.balanceOf(address(backstop)), 2_000 * USDC + prem - (win ? pay : 0));
    }
}
