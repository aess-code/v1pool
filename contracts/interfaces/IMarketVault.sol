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

    error Vault__UnauthorisedEngine();
    error Vault__UnauthorisedSettlement();
    error Vault__ZeroAmount();
    error Vault__InsufficientBalance();
    error Vault__ZeroAddress();
    error Vault__InvalidRecipient();
    error Vault__InvariantViolation();

    function deposit(uint256 amount) external;
    function withdraw(address to, uint256 amount) external;
    function settle(address to, uint256 amount) external;

    function viewId() external view returns (uint256);
    function token() external view returns (address);
    function balance() external view returns (uint256);
    function totalDeposits() external view returns (uint256);
    function totalWithdrawals() external view returns (uint256);
    function totalSettled() external view returns (uint256);
}
