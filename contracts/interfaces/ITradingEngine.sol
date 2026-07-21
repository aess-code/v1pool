// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITradingEngine
/// @notice Interface for the shared trading execution layer of Pulse Protocol V1.
/// @dev TradingEngine is the sole module responsible for:
///        - Executing Buy/Sell operations
///        - Internal Position Accounting (not ERC20/ERC1155 — non-transferable)
///        - Calling PriceEngine for stateless price computation
///        - Updating per-View Pulse Index
///        - Recording TWAP snapshots
///        - Interacting with per-View MarketVaults
///        - Calling FeeManager for fee accounting
///
///      All market state is stored per ViewID. Position Shares are internal
///      accounting entries and cannot be transferred or approved externally.
interface ITradingEngine {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Market lifecycle states.
    /// @dev Transitions are strictly one-directional and irreversible.
    enum MarketStatus {
        ACTIVE,       // Trading is open
        LOCKED,       // EndTime reached; trading halted; TWAP finalised
        SETTLEMENT,   // Awaiting settleMarket() call
        CLAIMABLE     // Settlement complete; users may claim rewards
    }

    /// @notice Snapshot of a single Pulse Index observation for TWAP calculation.
    struct TWAPSnapshot {
        uint256 pulseIndex; // Pulse Index in basis points at time of recording
        uint256 timestamp;  // Block timestamp of the observation
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a trade is executed.
    /// @param viewId     The ViewID the trade occurred in.
    /// @param trader     Address of the user who traded.
    /// @param side       0 = For, 1 = Against.
    /// @param isBuy      True if buy, false if sell.
    /// @param amountIn   Settlement token input (buy) or shares input (sell).
    /// @param amountOut  Shares output (buy) or settlement token output (sell).
    /// @param newIndex   Pulse Index after the trade (basis points).
    event TradeExecuted(
        uint256 indexed viewId,
        address indexed trader,
        uint256 side,
        bool    isBuy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 newIndex
    );

    /// @notice Emitted when the Pulse Index is updated.
    /// @param viewId   The ViewID.
    /// @param newIndex New Pulse Index in basis points.
    event PulseIndexUpdated(uint256 indexed viewId, uint256 newIndex);

    /// @notice Emitted when a TWAP snapshot is recorded.
    /// @param viewId     The ViewID.
    /// @param pulseIndex Pulse Index recorded.
    /// @param timestamp  Block timestamp of the snapshot.
    event TWAPSnapshotRecorded(uint256 indexed viewId, uint256 pulseIndex, uint256 timestamp);

    /// @notice Emitted when a market is locked (trading halted, TWAP finalised).
    /// @param viewId    The ViewID.
    /// @param finalTWAP The finalised TWAP value in basis points.
    event MarketLocked(uint256 indexed viewId, uint256 finalTWAP);

    /// @notice Emitted when a market's status is updated by SettlementManager.
    /// @param viewId    The ViewID.
    /// @param newStatus The new MarketStatus.
    event MarketStatusUpdated(uint256 indexed viewId, MarketStatus newStatus);

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the market is not in ACTIVE status for a trade.
    error TradingEngine__MarketNotActive(uint256 viewId);

    /// @notice Thrown when the market is not in LOCKED/SETTLEMENT status for lock/settle ops.
    error TradingEngine__InvalidStatus(uint256 viewId);

    /// @notice Thrown when the trade amount or share count is zero.
    error TradingEngine__ZeroAmount();

    /// @notice Thrown when the specified side is invalid.
    error TradingEngine__InvalidSide();

    /// @notice Thrown when the user has insufficient position shares to sell.
    error TradingEngine__InsufficientPosition(uint256 viewId, address user, uint256 side);

    /// @notice Thrown when the market has not yet reached its EndTime.
    error TradingEngine__EndTimeNotReached(uint256 viewId);

    /// @notice Thrown when the market is already locked.
    error TradingEngine__AlreadyLocked(uint256 viewId);

    /// @notice Thrown when the caller is not the authorised SettlementManager.
    error TradingEngine__UnauthorisedSettlement();

    /// @notice Thrown when the ViewID does not exist in the Registry.
    error TradingEngine__ViewNotFound(uint256 viewId);

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Buy a For or Against position in a View.
    /// @dev Requires market status == ACTIVE.
    ///      Calls PriceEngine for quote, updates internal state, calls FeeManager,
    ///      and deposits net amount into MarketVault.
    /// @param viewId   The ViewID to trade in.
    /// @param side     Position side: 0 = For, 1 = Against.
    /// @param amountIn Gross settlement token amount (fee deducted internally).
    function buy(uint256 viewId, uint256 side, uint256 amountIn) external;

    /// @notice Sell a For or Against position in a View.
    /// @dev Requires market status == ACTIVE.
    ///      Calls PriceEngine for quote, burns internal position, calls FeeManager,
    ///      and withdraws net amount from MarketVault.
    /// @param viewId    The ViewID to trade in.
    /// @param side      Position side: 0 = For, 1 = Against.
    /// @param sharesIn  Number of internal Position Shares to sell.
    function sell(uint256 viewId, uint256 side, uint256 sharesIn) external;

    /// @notice Lock a market after EndTime has been reached.
    /// @dev Permissionless — anyone may call once block.timestamp >= endTime.
    ///      Halts trading, finalises TWAP, and transitions status to SETTLEMENT.
    /// @param viewId The ViewID to lock.
    function lockMarket(uint256 viewId) external;

    /// @notice Update market status to CLAIMABLE after settlement is complete.
    /// @dev Only callable by the authorised SettlementManager.
    /// @param viewId The ViewID to update.
    function setStatusClaimable(uint256 viewId) external;

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the current Pulse Index for a View.
    /// @param viewId The ViewID to query.
    /// @return pulseIndex Current index in basis points (0–10000).
    function getPulseIndex(uint256 viewId) external view returns (uint256 pulseIndex);

    /// @notice Returns the current market status for a View.
    /// @param viewId The ViewID to query.
    function getMarketStatus(uint256 viewId) external view returns (MarketStatus);

    /// @notice Returns the current Vault token balance for a View.
    /// @param viewId The ViewID to query.
    function getVaultBalance(uint256 viewId) external view returns (uint256);

    /// @notice Returns a user's internal Position Share balance for a given side.
    /// @param viewId The ViewID to query.
    /// @param user   Address of the user.
    /// @param side   Position side: 0 = For, 1 = Against.
    function getPositionBalance(uint256 viewId, address user, uint256 side)
        external
        view
        returns (uint256 shares);

    /// @notice Returns the finalised TWAP for a locked or settled market.
    /// @dev Reverts if the market has not yet been locked.
    /// @param viewId The ViewID to query.
    /// @return twap Finalised TWAP in basis points.
    function getFinalTWAP(uint256 viewId) external view returns (uint256 twap);

    /// @notice Returns the total For and Against Position Shares outstanding.
    /// @param viewId The ViewID to query.
    /// @return forSupply     Total For shares.
    /// @return againstSupply Total Against shares.
    function getSupply(uint256 viewId)
        external
        view
        returns (uint256 forSupply, uint256 againstSupply);
}
