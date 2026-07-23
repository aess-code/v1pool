// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMarketVault
/// @notice Interface for the per-View isolated collateral custody vault in Pulse Protocol V1.
/// @dev V1 ONLY supports standard ERC20 collateral. Fee-on-transfer, rebasing,
///      and callback tokens are NOT supported.
interface IMarketVault {

    event Deposited(uint256 indexed viewId, address indexed caller, uint256 amount);
    event Withdrawn(uint256 indexed viewId, address indexed receiver, uint256 amount);
    event Settled(uint256 indexed viewId, address indexed receiver, uint256 amount);

    /// @notice Emitted when a fee is released from the Vault to a fee recipient via FeeManager.
    /// @param viewId    The ViewID the fee originated from.
    /// @param recipient The address receiving the released fee.
    /// @param amount    The amount of settlement token released.
    event FeeReleased(uint256 indexed viewId, address indexed recipient, uint256 amount);

    /// @notice Emitted when the FeeManager notifies the Vault of a newly recorded fee obligation.
    /// @param viewId The ViewID the fee originated from.
    /// @param amount The fee amount recorded by the FeeManager.
    event FeeRecordedNotified(uint256 indexed viewId, uint256 amount);

    error Vault__UnauthorisedEngine();
    error Vault__UnauthorisedSettlement();
    error Vault__UnauthorisedFeeManager();
    error Vault__ZeroAmount();
    error Vault__InsufficientBalance();
    error Vault__ZeroAddress();
    error Vault__InvalidRecipient();
    error Vault__InvariantViolation();
    error Vault__FeeManagerNotSet();
    error Vault__FeeManagerAlreadySet();

    /// @notice Thrown when releaseFee() would cause totalFeesReleased to exceed totalFeesRecorded.
    error Vault__FeeExceedsRecorded(uint256 requested, uint256 available);

    function deposit(uint256 amount) external;
    function withdraw(address to, uint256 amount) external;
    function settle(address to, uint256 amount) external;

    /// @notice Release accumulated fee collateral to a recipient.
    /// @dev Only callable by the authorised FeeManager.
    ///      This function is the ONLY mechanism by which fee collateral leaves the Vault.
    ///      It MUST NOT release more than the accumulated unclaimed fees.
    ///      The FeeManager is responsible for ensuring the amount does not exceed the
    ///      recorded fee obligations before calling this function.
    /// @param recipient The address to receive the released fee tokens.
    /// @param amount    The amount of settlement token to release.
    function releaseFee(address recipient, uint256 amount) external;

    /// @notice Initialise the authorised FeeManager address.
    /// @dev Called once by the Factory after deployment. Cannot be changed after set.
    ///      This design avoids modifying the constructor while preserving immutability semantics.
    /// @param feeManager The address of the authorised FeeManager.
    function setFeeManager(address feeManager) external;

    /// @notice Notify the Vault that a fee obligation has been recorded by the FeeManager.
    /// @dev Only callable by the authorised FeeManager. Called immediately after recordFee().
    ///      Increments totalFeesRecorded, which acts as the independent upper bound for releaseFee().
    ///      This ensures the Vault can independently verify that fee releases never exceed
    ///      the sum of all fees recorded by the FeeManager.
    /// @param amount The fee amount that was recorded.
    function notifyFeeRecorded(uint256 amount) external;

    function viewId() external view returns (uint256);
    function token() external view returns (address);
    function balance() external view returns (uint256);
    function totalDeposits() external view returns (uint256);
    function totalWithdrawals() external view returns (uint256);
    function totalSettled() external view returns (uint256);
    function totalFeesReleased() external view returns (uint256);
    function totalFeesRecorded() external view returns (uint256);
    function authorizedFeeManager() external view returns (address);
}
