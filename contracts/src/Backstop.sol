// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Backstop
/// @notice Parametric event cover paid in USDC. Each policy is priced from Gemini prediction
///         market odds (signed quote from `quoteSigner`) and hedged offchain by buying the
///         matching Gemini contracts. The contract holds a USDC float and locks each open
///         policy's full payout, so every open policy is always fully payable or refundable.
/// @dev All USDC amounts use the ERC-20 interface (6 decimals).
contract Backstop is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_NO = 2;

    enum Status {
        None,
        Active,
        PaidOut,
        Expired,
        Refunded
    }

    struct Quote {
        address buyer;
        bytes32 marketId; // keccak256(bytes(instrumentSymbol))
        uint8 outcome; // 1 = YES, 2 = NO
        uint256 payout; // USDC base units paid if the covered outcome happens
        uint256 premium; // USDC base units charged now
        uint64 quoteExpiry; // unix seconds; quote unusable after this
        uint64 resolveBy; // unix seconds; expected resolution deadline
        uint256 nonce; // single-use
    }

    struct Policy {
        address buyer;
        uint8 outcome;
        Status status;
        uint64 resolveBy;
        bytes32 marketId;
        uint256 payout;
        uint256 premium;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address buyer,bytes32 marketId,uint8 outcome,uint256 payout,uint256 premium,uint64 quoteExpiry,uint64 resolveBy,uint256 nonce)"
    );

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    IERC20 public immutable usdc;

    address public quoteSigner;
    address public resolver;

    uint256 public maxPayoutPerPolicy;
    uint256 public maxExposurePerMarket;
    uint64 public refundGracePeriod;

    /// @notice Sum of payouts of all Active policies.
    uint256 public lockedLiquidity;

    uint256 public nextPolicyId = 1;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => bool) public usedNonces;
    /// @notice Sum of payouts of Active policies per market.
    mapping(bytes32 => uint256) public marketExposure;
    /// @notice 0 = unresolved, 1 = YES, 2 = NO.
    mapping(bytes32 => uint8) public marketResult;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PolicyPurchased(
        uint256 indexed policyId,
        address indexed buyer,
        bytes32 indexed marketId,
        string instrumentSymbol,
        uint8 outcome,
        uint256 payout,
        uint256 premium
    );
    event PolicyCancelled(uint256 indexed policyId, uint256 refunded);
    event RefundClaimed(uint256 indexed policyId, uint256 refunded);
    event MarketResolved(bytes32 indexed marketId, uint8 result);
    event PolicySettled(uint256 indexed policyId, bool paid, uint256 amount);
    event TreasuryDeposited(address indexed from, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event QuoteSignerUpdated(address signer);
    event ResolverUpdated(address resolver);
    event CapsUpdated(uint256 maxPayoutPerPolicy, uint256 maxExposurePerMarket);
    event RefundGracePeriodUpdated(uint64 refundGracePeriod);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error NotResolver();
    error NotBuyer();
    error InvalidSignature();
    error QuoteExpired();
    error NonceUsed();
    error SymbolMismatch();
    error InvalidOutcome();
    error InvalidAmounts();
    error InvalidResolveBy();
    error PayoutCapExceeded();
    error MarketCapExceeded();
    error InsufficientLiquidity();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error PolicyNotActive();
    error RefundNotYetAvailable();

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    constructor(
        IERC20 _usdc,
        address _quoteSigner,
        address _resolver,
        uint256 _maxPayoutPerPolicy,
        uint256 _maxExposurePerMarket,
        uint64 _refundGracePeriod
    ) Ownable(msg.sender) EIP712("Backstop", "1") {
        if (address(_usdc) == address(0) || _quoteSigner == address(0) || _resolver == address(0)) {
            revert ZeroAddress();
        }
        usdc = _usdc;
        quoteSigner = _quoteSigner;
        resolver = _resolver;
        maxPayoutPerPolicy = _maxPayoutPerPolicy;
        maxExposurePerMarket = _maxExposurePerMarket;
        refundGracePeriod = _refundGracePeriod;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice USDC held by the contract that is not reserved for open policies.
    function freeLiquidity() public view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        return bal > lockedLiquidity ? bal - lockedLiquidity : 0;
    }

    /// @notice EIP-712 digest the quote signer must sign.
    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    q.buyer,
                    q.marketId,
                    q.outcome,
                    q.payout,
                    q.premium,
                    q.quoteExpiry,
                    q.resolveBy,
                    q.nonce
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    // ---------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------

    /// @notice Buy cover using a quote signed by the backend. Pulls `q.premium` USDC from the buyer.
    function buyPolicy(Quote calldata q, bytes calldata sig, string calldata instrumentSymbol)
        external
        nonReentrant
        returns (uint256 policyId)
    {
        if (msg.sender != q.buyer) revert NotBuyer();
        if (block.timestamp > q.quoteExpiry) revert QuoteExpired();
        if (usedNonces[q.nonce]) revert NonceUsed();
        if (keccak256(bytes(instrumentSymbol)) != q.marketId) revert SymbolMismatch();
        if (q.outcome != OUTCOME_YES && q.outcome != OUTCOME_NO) revert InvalidOutcome();
        // premium < payout guarantees the locked payout also covers any premium refund.
        if (q.payout == 0 || q.premium == 0 || q.premium >= q.payout) revert InvalidAmounts();
        if (q.resolveBy <= block.timestamp) revert InvalidResolveBy();
        if (marketResult[q.marketId] != 0) revert MarketAlreadyResolved();
        if (ECDSA.recover(hashQuote(q), sig) != quoteSigner) revert InvalidSignature();
        if (q.payout > maxPayoutPerPolicy) revert PayoutCapExceeded();
        if (marketExposure[q.marketId] + q.payout > maxExposurePerMarket) revert MarketCapExceeded();
        if (freeLiquidity() < q.payout) revert InsufficientLiquidity();

        usedNonces[q.nonce] = true;
        lockedLiquidity += q.payout;
        marketExposure[q.marketId] += q.payout;

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            buyer: q.buyer,
            outcome: q.outcome,
            status: Status.Active,
            resolveBy: q.resolveBy,
            marketId: q.marketId,
            payout: q.payout,
            premium: q.premium
        });

        usdc.safeTransferFrom(msg.sender, address(this), q.premium);

        emit PolicyPurchased(policyId, q.buyer, q.marketId, instrumentSymbol, q.outcome, q.payout, q.premium);
    }

    /// @notice Pay out (or expire) a policy once its market is resolved. Callable by anyone.
    function settle(uint256 policyId) external nonReentrant {
        Policy storage p = policies[policyId];
        if (p.status != Status.Active) revert PolicyNotActive();
        uint8 result = marketResult[p.marketId];
        if (result == 0) revert MarketNotResolved();

        _unlock(p);

        if (p.outcome == result) {
            p.status = Status.PaidOut;
            usdc.safeTransfer(p.buyer, p.payout);
            emit PolicySettled(policyId, true, p.payout);
        } else {
            p.status = Status.Expired;
            emit PolicySettled(policyId, false, 0);
        }
    }

    /// @notice Buyer's protection against a dead relayer: reclaim the premium if the market is
    ///         still unresolved after `resolveBy + refundGracePeriod`.
    function claimRefund(uint256 policyId) external nonReentrant {
        Policy storage p = policies[policyId];
        if (p.status != Status.Active) revert PolicyNotActive();
        if (msg.sender != p.buyer) revert NotBuyer();
        if (marketResult[p.marketId] != 0) revert MarketAlreadyResolved();
        if (block.timestamp <= uint256(p.resolveBy) + refundGracePeriod) revert RefundNotYetAvailable();

        _unlock(p);
        p.status = Status.Refunded;
        usdc.safeTransfer(p.buyer, p.premium);
        emit RefundClaimed(policyId, p.premium);
    }

    // ---------------------------------------------------------------------
    // Resolver actions
    // ---------------------------------------------------------------------

    /// @notice Cancel a policy whose hedge could not be filled; refunds the full premium.
    function cancelAndRefund(uint256 policyId) external onlyResolver nonReentrant {
        Policy storage p = policies[policyId];
        if (p.status != Status.Active) revert PolicyNotActive();
        if (marketResult[p.marketId] != 0) revert MarketAlreadyResolved();

        _unlock(p);
        p.status = Status.Refunded;
        usdc.safeTransfer(p.buyer, p.premium);
        emit PolicyCancelled(policyId, p.premium);
    }

    /// @notice Record the final outcome of a market. Can only be set once.
    function resolveMarket(bytes32 marketId, uint8 result) external onlyResolver {
        if (result != OUTCOME_YES && result != OUTCOME_NO) revert InvalidOutcome();
        if (marketResult[marketId] != 0) revert MarketAlreadyResolved();
        marketResult[marketId] = result;
        emit MarketResolved(marketId, result);
    }

    // ---------------------------------------------------------------------
    // Owner actions
    // ---------------------------------------------------------------------

    function depositTreasury(uint256 amount) external onlyOwner {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposited(msg.sender, amount);
    }

    /// @notice Withdraw free liquidity only. Funds locked for open policies can never leave.
    function withdrawTreasury(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > freeLiquidity()) revert InsufficientLiquidity();
        usdc.safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    function setQuoteSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        quoteSigner = signer;
        emit QuoteSignerUpdated(signer);
    }

    function setResolver(address _resolver) external onlyOwner {
        if (_resolver == address(0)) revert ZeroAddress();
        resolver = _resolver;
        emit ResolverUpdated(_resolver);
    }

    function setCaps(uint256 _maxPayoutPerPolicy, uint256 _maxExposurePerMarket) external onlyOwner {
        maxPayoutPerPolicy = _maxPayoutPerPolicy;
        maxExposurePerMarket = _maxExposurePerMarket;
        emit CapsUpdated(_maxPayoutPerPolicy, _maxExposurePerMarket);
    }

    function setRefundGracePeriod(uint64 _refundGracePeriod) external onlyOwner {
        refundGracePeriod = _refundGracePeriod;
        emit RefundGracePeriodUpdated(_refundGracePeriod);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _unlock(Policy storage p) private {
        lockedLiquidity -= p.payout;
        marketExposure[p.marketId] -= p.payout;
    }
}
