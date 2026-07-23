// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITradingEngine
/// @notice Interface for the shared trading execution layer of Pulse Protocol V1.
/// @dev TradingEngine is the **sole module** responsible for:
///        - Executing Buy/Sell operations
///        - Internal Position Accounting (not ERC20/ERC1155 — non-transferable)
///        - Calling PriceEngine for stateless price computation
///        - Updating per-View Pulse Index and Reserve Balance
///        - Recording TWAP snapshots via TWAPLibrary
///        - Interacting with per-View MarketVaults
///        - Calling FeeManager for fee accounting
///        - Managing the Market Lifecycle State Machine (ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE)
///
///      All market state is stored per ViewID. Position Shares are internal
///      accounting entries and cannot be transferred or approved externally.
///
///      TradingEngine is the ONLY module authorised to advance the Market State Machine.
///      SettlementManager may ONLY call setStatusClaimable() after settlement is complete.
///      No other module may modify market status.
interface ITradingEngine {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Market lifecycle states.
    /// @dev Transitions are strictly one-directional and irreversible.
    ///      ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE
    enum MarketStatus {
        ACTIVE,       // Trading is open
        LOCKED,       // EndTime reached; trading halted; TWAP finalised
        SETTLEMENT,   // SettlementManager is executing settlement
        CLAIMABLE     // Settlement complete; users may claim rewards
    }

    /// @notice Complete snapshot of a market's runtime state.
    /// @dev All fields are stored per ViewID in TradingEngine storage.
    struct MarketState {
        MarketStatus status;          // Current lifecycle state
        uint256      reserveBalance;  // Virtual reserve balance (tracks net collateral)
        uint256      forSupply;       // Total For Position Shares outstanding
        uint256      againstSupply;   // Total Against Position Shares outstanding
        uint256      lastPulseIndex;  // Most recently computed Pulse Index (basis points)
        uint256      lastTradeTimestamp; // Block timestamp of the most recent trade
    }

    /// @notice Internal Position Accounting
    struct Position {
        uint256 forShares;
        uint256 againstShares;
        bool    claimStatus;
        uint256 lastUpdate;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a Buy trade is executed.
    /// @param viewId    The ViewID the trade occurred in.
    /// @param trader    Address of the user who bought.
    /// @param side      0 = For, 1 = Against.
    /// @param amountIn  Gross settlement token input (before fee deduction).
    /// @param sharesOut Position Shares minted to the buyer.
    /// @param newIndex  Pulse Index after the trade (basis points).
    event Bought(
        uint256 indexed viewId,
        address indexed trader,
        uint256 side,
        uint256 amountIn,
        uint256 sharesOut,
        uint256 newIndex
    );

    /// @notice Emitted when a Sell trade is executed.
    /// @param viewId    The ViewID the trade occurred in.
    /// @param trader    Address of the user who sold.
    /// @param side      0 = For, 1 = Against.
    /// @param sharesIn  Position Shares burned by the seller.
    /// @param amountOut Net settlement token returned to the seller (after fee deduction).
    /// @param newIndex  Pulse Index after the trade (basis points).
    event Sold(
        uint256 indexed viewId,
        address indexed trader,
        uint256 side,
        uint256 sharesIn,
        uint256 amountOut,
        uint256 newIndex
    );

    /// @notice Emitted when the Pulse Index is updated after any trade.
    /// @param viewId   The ViewID.
    /// @param newIndex New Pulse Index in basis points.
    event PulseIndexUpdated(uint256 indexed viewId, uint256 newIndex);

    /// @notice Emitted when a TWAP snapshot is recorded inside the settlement window.
    /// @param viewId     The ViewID.
    /// @param pulseIndex Pulse Index recorded at this snapshot.
    /// @param timestamp  Block timestamp of the snapshot.
    event TWAPSnapshotRecorded(uint256 indexed viewId, uint256 pulseIndex, uint256 timestamp);

    /// @notice Emitted when a market is locked (trading halted, TWAP finalised).
    /// @param viewId     The ViewID.
    /// @param finalTWAP  The finalised TWAP value in basis points.
    /// @param timestamp  Block timestamp of the lock.
    event MarketLocked(uint256 indexed viewId, uint256 finalTWAP, uint256 timestamp);

    /// @notice Emitted when the TWAP is finalised inside lockMarket().
    /// @param viewId    The ViewID.
    /// @param finalTWAP The definitive TWAP value used for settlement.
    event TWAPFinalised(uint256 indexed viewId, uint256 finalTWAP);

    /// @notice Emitted when the market status is advanced.
    /// @param viewId     The ViewID.
    /// @param oldStatus  Previous MarketStatus.
    /// @param newStatus  New MarketStatus.
    event MarketStatusChanged(uint256 indexed viewId, MarketStatus oldStatus, MarketStatus newStatus);

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when a trade is attempted and the market is not ACTIVE.
    error TradingEngine__MarketNotActive(uint256 viewId, MarketStatus current);

    /// @notice Thrown when lockMarket() is called but the market is not ACTIVE.
    error TradingEngine__InvalidStatus(uint256 viewId, MarketStatus current);

    /// @notice Thrown when the trade amount or share count is zero.
    error TradingEngine__ZeroAmount();

    /// @notice Thrown when the specified side is not 0 (FOR) or 1 (AGAINST).
    error TradingEngine__InvalidSide();

    /// @notice Thrown when the user has insufficient Position Shares to sell.
    error TradingEngine__InsufficientPosition(uint256 viewId, address user, uint256 side, uint256 balance, uint256 requested);

    /// @notice Thrown when lockMarket() is called before the View's EndTime.
    error TradingEngine__EndTimeNotReached(uint256 viewId, uint256 currentTime, uint256 endTime);

    /// @notice Thrown when the market is already locked (prevents double-lock).
    error TradingEngine__AlreadyLocked(uint256 viewId);

    /// @notice Thrown when a restricted function is called by an address other than the authorised SettlementManager.
    error TradingEngine__UnauthorisedSettlement();

    /// @notice Thrown when the ViewID does not exist in the Factory Registry.
    error TradingEngine__ViewNotFound(uint256 viewId);

    /// @notice Thrown when a zero address is supplied for a required constructor argument.
    error TradingEngine__ZeroAddress();

    /// @notice Thrown when the Vault address for a ViewID is not found (zero address).
    error TradingEngine__VaultNotFound(uint256 viewId);

    /// @notice Thrown when a function stub has not yet been implemented (Round 2/3 stubs).
    error TradingEngine__NotImplemented();

    /// @notice Thrown when PriceEngine returns an invalid output (zero shares, zero amount, or illegal index).
    error TradingEngine__InvalidPriceEngineOutput(uint256 viewId);

    /// @notice Thrown when the reserve balance is invalid after a trade (zero or overflow).
    error TradingEngine__InvalidReserveBalance(uint256 viewId, uint256 reserve);

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Buy a For or Against position in a View.
    /// @dev Requires market status == ACTIVE.
    ///      Execution order (CEI):
    ///        1. Validate status, side, and amount.
    ///        2. Call PriceEngine.quoteBuy() to compute sharesOut and new state.
    ///        3. Call FeeManager.recordFee() for internal fee accounting.
    ///        4. safeTransferFrom(user → vault, netAmount).
    ///        5. Call MarketVault.deposit(netAmount) for accounting confirmation.
    ///        6. Update MarketState (forSupply / againstSupply / reserveBalance / lastPulseIndex / lastTradeTimestamp).
    ///        7. Update positions[viewId][user].forShares/againstShares += sharesOut.
    ///        8. Call TWAPLibrary.tryRecordSnapshot().
    ///        9. Emit Bought, PulseIndexUpdated, TWAPSnapshotRecorded (if applicable).
    /// @param viewId   The ViewID to trade in.
    /// @param side     Position side: 0 = For, 1 = Against.
    /// @param amountIn Gross settlement token amount (fee deducted internally).
    /// @return sharesOut Number of Position Shares minted to the caller.
    function buy(uint256 viewId, uint256 side, uint256 amountIn) external returns (uint256 sharesOut);

    /// @notice Sell a For or Against position in a View.
    /// @dev Requires market status == ACTIVE.
    ///      Execution order (CEI):
    ///        1. Validate status, side, shares, and position balance.
    ///        2. Call PriceEngine.quoteSell() to compute amountOut and new state.
    ///        3. Update positions[viewId][user].forShares/againstShares -= sharesIn.
    ///        4. Update MarketState.
    ///        5. Call FeeManager.recordFee() for internal fee accounting.
    ///        6. Call MarketVault.withdraw(user, netAmountOut).
    ///        7. Call TWAPLibrary.tryRecordSnapshot().
    ///        8. Emit Sold, PulseIndexUpdated, TWAPSnapshotRecorded (if applicable).
    /// @param viewId   The ViewID to trade in.
    /// @param side     Position side: 0 = For, 1 = Against.
    /// @param sharesIn Number of internal Position Shares to sell.
    /// @return amountOut Net settlement token amount returned to the caller (after fees).
    function sell(uint256 viewId, uint256 side, uint256 sharesIn) external returns (uint256 amountOut);

    /// @notice Lock a market after EndTime has been reached.
    /// @dev Permissionless — anyone may call once block.timestamp >= endTime.
    ///      Execution order:
    ///        1. Validate status == ACTIVE.
    ///        2. Validate block.timestamp >= endTime.
    ///        3. Call TWAPLibrary.finaliseTWAP() and store finalTWAP.
    ///        4. Advance status: ACTIVE → LOCKED.
    ///        5. Emit MarketLocked, TWAPFinalised, MarketStatusChanged.
    ///
    ///      Note: lockMarket() transitions to LOCKED, NOT directly to SETTLEMENT.
    ///      The SettlementManager must call settleMarket() separately to advance to SETTLEMENT,
    ///      and then call setStatusClaimable() to advance to CLAIMABLE.
    /// @param viewId The ViewID to lock.
    function lockMarket(uint256 viewId) external;

    /// @notice Advance market status from SETTLEMENT to CLAIMABLE after settlement is complete.
    /// @dev ONLY callable by the authorised SettlementManager for this View.
    ///      This is the ONLY mechanism by which SettlementManager may modify TradingEngine state.
    ///      Emits MarketStatusChanged.
    /// @param viewId The ViewID to advance to CLAIMABLE.
    function setStatusClaimable(uint256 viewId) external;

    /// @notice Advance market status from LOCKED to SETTLEMENT.
    /// @dev ONLY callable by the authorised SettlementManager for this View.
    ///      Called at the start of settleMarket() before settlement logic executes.
    ///      Emits MarketStatusChanged.
    /// @param viewId The ViewID to advance to SETTLEMENT.
    function setStatusSettlement(uint256 viewId) external;

    /// @notice Mark a user's position as claimed.
    /// @dev ONLY callable by the authorised SettlementManager during claimReward().
    ///      Ensures TradingEngine remains the sole authority on Position state.
    /// @param viewId The ViewID.
    /// @param user   The user address.
    function markPositionClaimed(uint256 viewId, address user) external;

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the complete runtime MarketState for a View.
    /// @param viewId The ViewID to query.
    /// @return state The current MarketState struct.
    function getMarketState(uint256 viewId) external view returns (MarketState memory state);

    /// @notice Returns the current market status for a View.
    /// @param viewId The ViewID to query.
    function getMarketStatus(uint256 viewId) external view returns (MarketStatus);

    /// @notice Returns the current Pulse Index for a View.
    /// @param viewId The ViewID to query.
    /// @return pulseIndex Current index in basis points (1–9999).
    function getPulseIndex(uint256 viewId) external view returns (uint256 pulseIndex);

    /// @notice Returns the current virtual reserve balance for a View.
    /// @param viewId The ViewID to query.
    /// @return reserve Current reserve balance in settlement token units.
    function getReserve(uint256 viewId) external view returns (uint256 reserve);

    /// @notice Returns the total For and Against Position Shares outstanding.
    /// @param viewId The ViewID to query.
    /// @return forSupply     Total For shares.
    /// @return againstSupply Total Against shares.
    function getSupply(uint256 viewId)
        external
        view
        returns (uint256 forSupply, uint256 againstSupply);

    /// @notice Returns a user's full Position struct.
    /// @param viewId The ViewID to query.
    /// @param user   Address of the user.
    /// @return position The user's Position struct.
    function getPosition(uint256 viewId, address user)
        external
        view
        returns (Position memory position);

    /// @notice Returns the finalised TWAP for a locked or settled market.
    /// @dev Reverts with TradingEngine__InvalidStatus if the market has not yet been locked.
    /// @param viewId The ViewID to query.
    /// @return twap Finalised TWAP in basis points.
    function getFinalTWAP(uint256 viewId) external view returns (uint256 twap);

    /// @notice Returns the current Vault token balance for a View.
    /// @dev Reads directly from the MarketVault's balance() function.
    /// @param viewId The ViewID to query.
    function getVaultBalance(uint256 viewId) external view returns (uint256);
}
