// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IFeeManager }   from "../interfaces/IFeeManager.sol";
import { IPulseFactory } from "../interfaces/IPulseFactory.sol";
import { IMarketVault }  from "../interfaces/IMarketVault.sol";

/// @title FeeManager
/// @notice Protocol fee accounting and distribution module for Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      FeeManager is an **Accounting-Only** module.
///      It NEVER holds ERC20 tokens. All physical fee assets reside in MarketVault.
///
///      Fee Flow:
///        Trade occurs in TradingEngine
///          → TradingEngine calls FeeManager.recordFee() (accounting entry)
///          → FeeManager calls MarketVault.notifyFeeRecorded() (quota registration)
///          → Physical fee tokens remain in MarketVault
///
///      Claim Flow (Pull-over-Push):
///        Creator/Treasury/Team calls claimXxxFee()
///          → FeeManager zeroes internal ledger (CEI: Effect before Interaction)
///          → FeeManager calls MarketVault.releaseFee() (Vault transfers to recipient)
///
///      Fee Split (fixed per SSOT, immutable):
///        Total:    1.00% (100 bps)
///        Creator:  0.50% (50% of total fee)
///        Treasury: 0.30% (30% of total fee)
///        Team:     0.20% (20% of total fee)
///
///      ── Security Properties ───────────────────────────────────────────────
///      - Only authorised TradingEngine may call recordFee()
///      - Only the View's Creator may call claimCreatorFee()
///      - Only the configured treasury address may call claimTreasuryFee()
///      - Only the configured team address may call claimTeamFee()
///      - CEI pattern prevents reentrancy in all claim functions
///      - Vault-layer quota protection prevents over-release even if FeeManager is buggy
contract FeeManager is IFeeManager {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants — Fee Split (Fixed per SSOT)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Total fee in basis points. Fixed per protocol: 1.00%.
    uint256 public constant TOTAL_FEE_BPS      = 100;

    /// @notice Creator share: 50% of total fee (0.50% of trade value).
    uint256 public constant CREATOR_SHARE_BPS  = 50;

    /// @notice Treasury share: 30% of total fee (0.30% of trade value).
    uint256 public constant TREASURY_SHARE_BPS = 30;

    /// @notice Team share: 20% of total fee (0.20% of trade value).
    uint256 public constant TEAM_SHARE_BPS     = 20;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable Dependencies
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The authorised TradingEngine. Only this address may call recordFee().
    address public immutable authorizedTradingEngine;

    /// @notice The PulseFactory registry. Used to look up Vault and Creator addresses.
    IPulseFactory public immutable factory;

    /// @notice The protocol treasury address. Receives 30% of all fees.
    address public immutable treasury;

    /// @notice The protocol team address. Receives 20% of all fees.
    address public immutable team;

    // ─────────────────────────────────────────────────────────────────────────
    // State Variables
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pending creator fee balance per (viewId, creator).
    /// @dev Keyed by viewId → creator address → pending amount.
    ///      A creator may have positions in multiple Views.
    mapping(uint256 => mapping(address => uint256)) private _pendingCreatorFees;

    /// @notice Pending treasury fee balance per viewId.
    mapping(uint256 => uint256) private _pendingTreasuryFees;

    /// @notice Pending team fee balance per viewId.
    mapping(uint256 => uint256) private _pendingTeamFees;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy the FeeManager.
    /// @param _authorizedTradingEngine Address of the authorised TradingEngine.
    /// @param _factory                 Address of the PulseFactory registry.
    /// @param _treasury                Address of the protocol treasury.
    /// @param _team                    Address of the protocol team wallet.
    constructor(
        address _authorizedTradingEngine,
        address _factory,
        address _treasury,
        address _team
    ) {
        if (_authorizedTradingEngine == address(0)) revert FeeManager__UnauthorisedCaller();
        if (_factory                 == address(0)) revert FeeManager__InvalidCreator();
        if (_treasury                == address(0)) revert FeeManager__InvalidCreator();
        if (_team                    == address(0)) revert FeeManager__InvalidCreator();
        authorizedTradingEngine = _authorizedTradingEngine;
        factory                 = IPulseFactory(_factory);
        treasury                = _treasury;
        team                    = _team;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Restricts function to the authorised TradingEngine only.
    modifier onlyTradingEngine() {
        if (msg.sender != authorizedTradingEngine) revert FeeManager__UnauthorisedCaller();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IFeeManager
    /// @dev Only callable by the authorised TradingEngine.
    ///      Splits totalFee into creator/treasury/team shares using integer division.
    ///      Dust from rounding is absorbed into the team share (last calculated as remainder).
    ///
    ///      After updating internal ledgers, notifies the Vault of the new fee obligation
    ///      so the Vault can independently enforce the release quota.
    function recordFee(
        uint256 viewId,
        address creator,
        uint256 totalFee
    ) external override onlyTradingEngine {
        if (totalFee == 0)          revert FeeManager__ZeroFee();
        if (creator  == address(0)) revert FeeManager__InvalidCreator();

        // Split fee: creator 50%, treasury 30%, team absorbs remainder (dust)
        uint256 creatorFee  = (totalFee * CREATOR_SHARE_BPS)  / 100;
        uint256 treasuryFee = (totalFee * TREASURY_SHARE_BPS) / 100;
        uint256 teamFee     = totalFee - creatorFee - treasuryFee;

        // Update internal ledgers
        _pendingCreatorFees[viewId][creator] += creatorFee;
        _pendingTreasuryFees[viewId]         += treasuryFee;
        _pendingTeamFees[viewId]             += teamFee;

        emit FeeRecorded(viewId, creator, totalFee, creatorFee, treasuryFee, teamFee);

        // Notify Vault of the new fee obligation (enables Vault-layer quota protection).
        // If Vault is not yet registered (e.g. in tests), skip gracefully.
        address vaultAddr = factory.getVault(viewId);
        if (vaultAddr != address(0)) {
            IMarketVault(vaultAddr).notifyFeeRecorded(totalFee);
        }
    }

    /// @inheritdoc IFeeManager
    /// @dev Only the Creator of the View may claim their fee.
    ///      The Creator address is read from the Factory registry (immutable per View).
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — caller is the View's Creator, pending > 0
    ///        2. EFFECT — zero the pending balance (prevents reentrancy double-claim)
    ///        3. INTERACT — call Vault.releaseFee() to transfer tokens to creator
    function claimCreatorFee(uint256 viewId) external override {
        // Resolve creator from Factory (immutable per View)
        IPulseFactory.ViewRecord memory view_ = factory.getView(viewId);
        address creator = view_.creator;

        // Only the View's Creator may claim
        if (msg.sender != creator) revert FeeManager__UnauthorisedCaller();

        uint256 amount = _pendingCreatorFees[viewId][creator];
        if (amount == 0) revert FeeManager__NothingToClaim();

        // CEI: zero ledger before external interaction
        _pendingCreatorFees[viewId][creator] = 0;

        // Release from Vault
        IMarketVault(view_.vault).releaseFee(creator, amount);

        emit CreatorFeeClaimed(viewId, creator, amount);
    }

    /// @inheritdoc IFeeManager
    /// @dev Only the configured treasury address may claim.
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — caller is treasury, pending > 0
    ///        2. EFFECT — zero the pending balance
    ///        3. INTERACT — call Vault.releaseFee()
    function claimTreasuryFee(uint256 viewId) external override {
        if (msg.sender != treasury) revert FeeManager__UnauthorisedCaller();

        uint256 amount = _pendingTreasuryFees[viewId];
        if (amount == 0) revert FeeManager__NothingToClaim();

        // CEI: zero ledger before external interaction
        _pendingTreasuryFees[viewId] = 0;

        address vaultAddr = factory.getVault(viewId);
        IMarketVault(vaultAddr).releaseFee(treasury, amount);

        emit TreasuryFeeClaimed(viewId, treasury, amount);
    }

    /// @inheritdoc IFeeManager
    /// @dev Only the configured team address may claim.
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — caller is team, pending > 0
    ///        2. EFFECT — zero the pending balance
    ///        3. INTERACT — call Vault.releaseFee()
    function claimTeamFee(uint256 viewId) external override {
        if (msg.sender != team) revert FeeManager__UnauthorisedCaller();

        uint256 amount = _pendingTeamFees[viewId];
        if (amount == 0) revert FeeManager__NothingToClaim();

        // CEI: zero ledger before external interaction
        _pendingTeamFees[viewId] = 0;

        address vaultAddr = factory.getVault(viewId);
        IMarketVault(vaultAddr).releaseFee(team, amount);

        emit TeamFeeClaimed(viewId, team, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IFeeManager
    function pendingCreatorFees(uint256 viewId, address creator)
        external
        view
        override
        returns (uint256)
    {
        return _pendingCreatorFees[viewId][creator];
    }

    /// @inheritdoc IFeeManager
    function pendingTreasuryFees(uint256 viewId)
        external
        view
        override
        returns (uint256)
    {
        return _pendingTreasuryFees[viewId];
    }

    /// @inheritdoc IFeeManager
    function pendingTeamFees(uint256 viewId)
        external
        view
        override
        returns (uint256)
    {
        return _pendingTeamFees[viewId];
    }

    /// @inheritdoc IFeeManager
    function feeConfig()
        external
        pure
        override
        returns (
            uint256 creatorBps,
            uint256 treasuryBps,
            uint256 teamBps,
            uint256 totalBps
        )
    {
        return (CREATOR_SHARE_BPS, TREASURY_SHARE_BPS, TEAM_SHARE_BPS, TOTAL_FEE_BPS);
    }
}
