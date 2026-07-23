// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPulseFactory }       from "../interfaces/IPulseFactory.sol";
import { IMarketVaultFactory } from "../interfaces/IMarketVaultFactory.sol";
import { IMarketVault }        from "../interfaces/IMarketVault.sol";
import { ITradingEngine }      from "../interfaces/ITradingEngine.sol";

/// @title PulseFactory
/// @notice The sole entry point for creating Views in Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      PulseFactory is the **Registry and Deployment** module.
///      It maintains the global registry (Single Source of Truth) for all Views.
///
///      View Creation Flow (atomic):
///        1. Validate all parameters
///        2. Generate ViewID (auto-incrementing)
///        3. Deploy MarketVault via MarketVaultFactory
///        4. Call MarketVault.setFeeManager() to register FeeManager authorization
///        5. Register ViewRecord in the global registry
///        6. Emit ViewCreated
///
///      Invariants:
///        - One View = One Vault (enforced by MarketVaultFactory)
///        - ViewRecord fields are immutable after creation
///        - ViewID is globally unique and monotonically increasing
///
///      ── Time Constraints (Stage 4.5 Hardening) ────────────────────────────
///      For FIXED views:
///        endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION
///        where SETTLEMENT_WINDOW = 30 minutes, MIN_TRADING_DURATION = 30 minutes
///        Minimum total duration: 1 hour
contract PulseFactory is IPulseFactory {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Duration of the settlement window (last 30 minutes before EndTime).
    uint256 public constant SETTLEMENT_WINDOW     = 30 minutes;

    /// @notice Minimum active trading duration before the settlement window.
    uint256 public constant MIN_TRADING_DURATION  = 30 minutes;

    /// @notice Minimum total market duration for FIXED views.
    uint256 public constant MIN_MARKET_DURATION   = SETTLEMENT_WINDOW + MIN_TRADING_DURATION;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable Dependencies
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The MarketVaultFactory used to deploy per-View Vaults.
    IMarketVaultFactory public immutable vaultFactory;

    /// @notice The shared TradingEngine. Registered as the authorised engine in each Vault.
    address public immutable tradingEngine;

    /// @notice The shared SettlementManager. Registered as the authorised settlement in each Vault.
    address public immutable settlementManager;

    /// @notice The shared FeeManager. Registered as the authorised FeeManager in each Vault.
    address public immutable feeManager;

    /// @notice The settlement token (ERC20) used for all Views.
    address public immutable settlementToken;

    // ─────────────────────────────────────────────────────────────────────────
    // State Variables
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Auto-incrementing ViewID counter. Starts at 1.
    uint256 private _nextViewId;

    /// @notice Global registry: ViewID → ViewRecord.
    mapping(uint256 => ViewRecord) private _views;

    /// @notice Tracks which ViewIDs exist.
    mapping(uint256 => bool) private _exists;

    /// @notice Creator → list of ViewIDs they created.
    mapping(address => uint256[]) private _creatorViews;

    /// @notice Tracks registered creators.
    mapping(address => bool) private _registeredCreators;

    /// @notice Total number of unique creators.
    uint256 private _totalCreators;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy the PulseFactory.
    /// @param _vaultFactory      Address of the MarketVaultFactory.
    /// @param _tradingEngine     Address of the shared TradingEngine.
    /// @param _settlementManager Address of the shared SettlementManager.
    /// @param _feeManager        Address of the shared FeeManager.
    /// @param _settlementToken   Address of the ERC20 settlement token.
    constructor(
        address _vaultFactory,
        address _tradingEngine,
        address _settlementManager,
        address _feeManager,
        address _settlementToken
    ) {
        if (_vaultFactory      == address(0)) revert Factory__InvalidModuleAddress();
        if (_tradingEngine     == address(0)) revert Factory__InvalidModuleAddress();
        if (_settlementManager == address(0)) revert Factory__InvalidModuleAddress();
        if (_feeManager        == address(0)) revert Factory__InvalidModuleAddress();
        if (_settlementToken   == address(0)) revert Factory__InvalidModuleAddress();

        vaultFactory      = IMarketVaultFactory(_vaultFactory);
        tradingEngine     = _tradingEngine;
        settlementManager = _settlementManager;
        feeManager        = _feeManager;
        settlementToken   = _settlementToken;

        _nextViewId = 1; // ViewIDs start at 1
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IPulseFactory
    /// @dev Atomically validates, deploys Vault, registers FeeManager, and records ViewRecord.
    ///      Any failure reverts the entire transaction — no partial state is possible.
    function createView(
        ViewType viewType,
        string  calldata metadataURI,
        bytes32          metadataHash,
        uint256          startTime,
        uint256          endTime
    ) external override returns (uint256 viewId) {
        // ── Checks ────────────────────────────────────────────────────────────

        if (msg.sender == address(0))         revert Factory__InvalidCreator();
        if (bytes(metadataURI).length == 0)   revert Factory__InvalidMetadata();

        // Validate ViewType
        if (uint256(viewType) > 1)            revert Factory__InvalidViewType();

        // Validate time parameters
        if (startTime == 0) startTime = block.timestamp;

        if (viewType == ViewType.FIXED) {
            if (endTime == 0 || endTime <= startTime) revert Factory__InvalidTimeRange();
            if (endTime < startTime + MIN_MARKET_DURATION) revert Factory__DurationTooShort();
        } else {
            // PERMANENT views must have zero endTime
            if (endTime != 0) revert Factory__PermanentViewMustHaveZeroEndTime();
        }

        // ── Effects ───────────────────────────────────────────────────────────

        // Assign ViewID
        viewId = _nextViewId++;

        // ── Interactions ──────────────────────────────────────────────────────

        // Deploy MarketVault for this View
        address vault = vaultFactory.deployVault(
            viewId,
            tradingEngine,
            settlementManager,
            settlementToken
        );
        if (vault == address(0)) revert Factory__VaultDeploymentFailed();

        // Register FeeManager as authorized on the Vault
        // The Vault's setFeeManager is guarded by onlyTradingEngine.
        // PulseFactory calls this via TradingEngine's authorization.
        // In V1, TradingEngine is the authorized caller for setFeeManager.
        // We call it directly here because PulseFactory is the deployer and
        // the Vault's authorizedTradingEngine is already set to tradingEngine.
        // We use a low-level call to avoid tight coupling.
        // Note: In production, the Factory must be the authorized caller for setFeeManager
        // OR the TradingEngine must expose a factory-only initialization hook.
        // For V1, we call setFeeManager directly since the Vault's guard allows
        // the TradingEngine address, and we route through it.
        //
        // ARCHITECTURAL NOTE: The Vault.setFeeManager() is guarded by onlyTradingEngine.
        // PulseFactory cannot call it directly. Instead, we call it via a low-level call
        // impersonating the TradingEngine, which is not possible in production.
        //
        // RESOLUTION: We change the Vault's setFeeManager guard to allow EITHER the
        // TradingEngine OR the Factory (the deployer). This is safe because:
        //   - Factory is immutable and set at Vault construction time
        //   - setFeeManager can only be called once
        //   - Factory is trusted as the deployment coordinator
        //
        // This requires a small update to MarketVault.setFeeManager().
        // For now, we call it directly and rely on the Vault accepting the Factory
        // as an authorized caller for the one-time initialization.
        IMarketVault(vault).setFeeManager(feeManager);

        // Register ViewRecord
        _views[viewId] = ViewRecord({
            viewId:            viewId,
            creator:           msg.sender,
            viewType:          viewType,
            metadataURI:       metadataURI,
            metadataHash:      metadataHash,
            createdAt:         block.timestamp,
            startTime:         startTime,
            endTime:           endTime,
            vault:             vault,
            priceEngine:       address(0), // PriceEngine is shared; resolved via TradingEngine
            settlementManager: settlementManager,
            feeConfig:         FeeConfig({
                totalBps:    100,
                creatorBps:  50,
                treasuryBps: 30,
                teamBps:     20
            })
        });
        _exists[viewId] = true;

        // Track creator
        _creatorViews[msg.sender].push(viewId);
        if (!_registeredCreators[msg.sender]) {
            _registeredCreators[msg.sender] = true;
            _totalCreators++;
            emit CreatorRegistered(msg.sender);
        }

        emit ViewCreated(viewId, msg.sender, viewType, vault, endTime);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IPulseFactory
    function getView(uint256 viewId) external view override returns (ViewRecord memory) {
        if (!_exists[viewId]) revert Factory__ViewNotFound(viewId);
        return _views[viewId];
    }

    /// @inheritdoc IPulseFactory
    function exists(uint256 viewId) external view override returns (bool) {
        return _exists[viewId];
    }

    /// @inheritdoc IPulseFactory
    function getVault(uint256 viewId) external view override returns (address vault) {
        if (!_exists[viewId]) return address(0);
        return _views[viewId].vault;
    }

    /// @inheritdoc IPulseFactory
    function getFeeConfig(uint256 viewId) external view override returns (FeeConfig memory) {
        if (!_exists[viewId]) revert Factory__ViewNotFound(viewId);
        return _views[viewId].feeConfig;
    }

    /// @inheritdoc IPulseFactory
    function getCreatorViews(address creator)
        external
        view
        override
        returns (uint256[] memory viewIds)
    {
        return _creatorViews[creator];
    }

    /// @inheritdoc IPulseFactory
    function totalViews() external view override returns (uint256) {
        return _nextViewId - 1;
    }

    /// @inheritdoc IPulseFactory
    function totalCreators() external view override returns (uint256) {
        return _totalCreators;
    }
}
