// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFeeManager
/// @notice Interface for the protocol fee accounting and distribution module.
/// @dev Implements a Pull-over-Push model. TradingEngine records fee obligations
///      during trades; no active transfers occur at trade time. Creator, Treasury,
///      and Team must call claimFees() to withdraw their accumulated balances.
///
///      Fee structure (fixed per protocol V1 rules, immutable per View):
///        Total:    1.00%
///        Creator:  0.50%
///        Treasury: 0.30%
///        Team:     0.20%
interface IFeeManager {

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a fee is recorded during a trade.
    /// @param viewId       The ViewID the fee originated from.
    /// @param creator      The Creator of the View receiving the creator share.
    /// @param totalFee     Total fee amount collected from the trade.
    /// @param creatorFee   Creator's share of the fee.
    /// @param treasuryFee  Treasury's share of the fee.
    /// @param teamFee      Team's share of the fee.
    event FeeRecorded(
        uint256 indexed viewId,
        address indexed creator,
        uint256 totalFee,
        uint256 creatorFee,
        uint256 treasuryFee,
        uint256 teamFee
    );

    /// @notice Emitted when a Creator claims their accumulated fees.
    /// @param viewId   The ViewID the fee belongs to.
    /// @param creator  Address of the Creator.
    /// @param amount   Amount of settlement token claimed.
    event CreatorFeeClaimed(uint256 indexed viewId, address indexed creator, uint256 amount);

    /// @notice Emitted when the Treasury claims accumulated fees.
    /// @param viewId   The ViewID the fee belongs to.
    /// @param treasury Address of the Treasury.
    /// @param amount   Amount of settlement token claimed.
    event TreasuryFeeClaimed(uint256 indexed viewId, address indexed treasury, uint256 amount);

    /// @notice Emitted when the Team claims accumulated fees.
    /// @param viewId   The ViewID the fee belongs to.
    /// @param team   Address of the Team wallet.
    /// @param amount Amount of settlement token claimed.
    event TeamFeeClaimed(uint256 indexed viewId, address indexed team, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the caller is not the authorised TradingEngine.
    error FeeManager__UnauthorisedCaller();

    /// @notice Thrown when the fee amount is zero.
    error FeeManager__ZeroFee();

    /// @notice Thrown when there are no fees available to claim.
    error FeeManager__NothingToClaim();

    /// @notice Thrown when the creator address is the zero address.
    error FeeManager__InvalidCreator();

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Record a fee obligation arising from a trade.
    /// @dev Only callable by the authorised TradingEngine.
    ///      Splits `totalFee` into creator/treasury/team shares and updates
    ///      internal pending balances. No token transfer occurs.
    /// @param viewId    The ViewID the trade occurred in.
    /// @param creator   Address of the View's Creator.
    /// @param totalFee  Total fee amount (1% of trade value) in settlement tokens.
    function recordFee(
        uint256 viewId,
        address creator,
        uint256 totalFee
    ) external;

    /// @notice Creator withdraws their accumulated fee balance for a specific View.
    /// @dev Uses Checks-Effects-Interactions: balance set to zero before transfer.
    ///      Only the creator of `viewId` may call this.
    /// @param viewId The ViewID to claim fees from.
    function claimCreatorFee(uint256 viewId) external;

    /// @notice Treasury address withdraws its accumulated fee balance for a specific View.
    /// @dev Only callable by the configured treasury address.
    /// @param viewId The ViewID to claim fees from.
    function claimTreasuryFee(uint256 viewId) external;

    /// @notice Team address withdraws its accumulated fee balance for a specific View.
    /// @dev Only callable by the configured team address.
    /// @param viewId The ViewID to claim fees from.
    function claimTeamFee(uint256 viewId) external;

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the pending claimable creator fee balance for a specific View.
    /// @param viewId The ViewID to query.
    /// @param creator Address of the Creator.
    function pendingCreatorFees(uint256 viewId, address creator) external view returns (uint256);

    /// @notice Returns the pending claimable treasury fee balance for a specific View.
    /// @param viewId The ViewID to query.
    function pendingTreasuryFees(uint256 viewId) external view returns (uint256);

    /// @notice Returns the pending claimable team fee balance for a specific View.
    /// @param viewId The ViewID to query.
    function pendingTeamFees(uint256 viewId) external view returns (uint256);

    /// @notice Returns the fee split configuration in basis points.
    /// @return creatorBps   Creator share in basis points (e.g. 50 = 0.50%).
    /// @return treasuryBps  Treasury share in basis points (e.g. 30 = 0.30%).
    /// @return teamBps      Team share in basis points (e.g. 20 = 0.20%).
    /// @return totalBps     Total fee in basis points (e.g. 100 = 1.00%).
    function feeConfig()
        external
        view
        returns (
            uint256 creatorBps,
            uint256 treasuryBps,
            uint256 teamBps,
            uint256 totalBps
        );
}
