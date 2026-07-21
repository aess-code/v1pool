// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMarketVaultFactory
/// @notice Interface for the factory that deploys per-View MarketVault instances.
/// @dev Only PulseFactory is authorised to call deployVault().
///      Enforces the protocol invariant: One View = One Independent Vault.
interface IMarketVaultFactory {

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a new MarketVault is deployed.
    /// @param viewId       The ViewID the Vault belongs to.
    /// @param vault        Address of the newly deployed MarketVault.
    /// @param token        Address of the settlement token.
    event VaultDeployed(uint256 indexed viewId, address indexed vault, address indexed token);

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the caller is not the authorised PulseFactory.
    error VaultFactory__Unauthorised();

    /// @notice Thrown when a Vault for the given ViewID already exists.
    error VaultFactory__AlreadyDeployed(uint256 viewId);

    /// @notice Thrown when a zero address is supplied for a required parameter.
    error VaultFactory__ZeroAddress();

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy a new independent MarketVault for a given View.
    /// @dev Only callable by the authorised PulseFactory.
    ///      Reverts if a Vault for `viewId` already exists.
    /// @param viewId               Unique identifier of the View.
    /// @param authorisedEngine     Address of the shared TradingEngine.
    /// @param authorisedSettlement Address of the shared SettlementManager.
    /// @param token                Address of the settlement token (e.g. USDT).
    /// @return vault               Address of the newly deployed MarketVault.
    function deployVault(
        uint256 viewId,
        address authorisedEngine,
        address authorisedSettlement,
        address token
    ) external returns (address vault);

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the Vault address for a given ViewID.
    /// @param viewId The ViewID to query.
    /// @return vault Address of the MarketVault, or address(0) if not deployed.
    function getVault(uint256 viewId) external view returns (address vault);

    /// @notice Returns whether a Vault exists for the given ViewID.
    /// @param viewId The ViewID to query.
    function vaultExists(uint256 viewId) external view returns (bool);
}
