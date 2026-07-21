// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MarketVault }         from "./MarketVault.sol";
import { IMarketVaultFactory } from "../interfaces/IMarketVaultFactory.sol";

/// @title MarketVaultFactory
/// @notice Deploys and registers per-View MarketVault instances for Pulse Protocol V1.
/// @dev Only the authorised PulseFactory may call deployVault().
///      Enforces the protocol invariant: One View = One Independent Vault.
///
///      Responsibilities:
///        - Deploy a new MarketVault for each View
///        - Register the Vault address keyed by ViewID
///        - Return the Vault address to PulseFactory
///
///      This contract does NOT:
///        - Manage user funds
///        - Modify Vault rules after deployment
///        - Change collateral tokens
///        - Bypass Vault authorization
///
///      Upgrade boundary:
///        Existing Vault deployments are immutable. A new MarketVaultFactory
///        may be deployed for future Views without affecting existing Vaults.
contract MarketVaultFactory is IMarketVaultFactory {

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The authorised PulseFactory address. Set at construction, immutable.
    address public immutable authorizedFactory;

    // ─────────────────────────────────────────────────────────────────────────
    // Mutable State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Maps ViewID → deployed MarketVault address.
    mapping(uint256 => address) private _vaults;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy the MarketVaultFactory.
    /// @param _authorizedFactory Address of the PulseFactory that may call deployVault().
    constructor(address _authorizedFactory) {
        if (_authorizedFactory == address(0)) revert VaultFactory__ZeroAddress();
        authorizedFactory = _authorizedFactory;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modifier
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Restricts function to the authorised PulseFactory only.
    modifier onlyAuthorizedFactory() {
        if (msg.sender != authorizedFactory) revert VaultFactory__Unauthorised();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMarketVaultFactory
    /// @dev Deployment is atomic: if the MarketVault constructor reverts, the entire
    ///      transaction reverts and no Vault is registered.
    ///
    ///      Steps:
    ///        1. Validate inputs
    ///        2. Check no Vault already exists for viewId
    ///        3. Deploy new MarketVault
    ///        4. Register in _vaults mapping
    ///        5. Emit VaultDeployed
    function deployVault(
        uint256 viewId,
        address authorisedEngine,
        address authorisedSettlement,
        address token
    )
        external
        override
        onlyAuthorizedFactory
        returns (address vault)
    {
        // --- Checks ---
        if (authorisedEngine     == address(0)) revert VaultFactory__ZeroAddress();
        if (authorisedSettlement == address(0)) revert VaultFactory__ZeroAddress();
        if (token                == address(0)) revert VaultFactory__ZeroAddress();
        if (_vaults[viewId]      != address(0)) revert VaultFactory__AlreadyDeployed(viewId);

        // --- Effects + Interaction (atomic deployment) ---
        // The MarketVault constructor validates all addresses internally.
        // If it reverts, the entire transaction reverts — no partial state.
        MarketVault newVault = new MarketVault(
            viewId,
            token,
            authorisedEngine,
            authorisedSettlement
        );

        vault = address(newVault);

        // Register the Vault address.
        _vaults[viewId] = vault;

        emit VaultDeployed(viewId, vault, token);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMarketVaultFactory
    function getVault(uint256 viewId) external view override returns (address vault) {
        return _vaults[viewId];
    }

    /// @inheritdoc IMarketVaultFactory
    function vaultExists(uint256 viewId) external view override returns (bool) {
        return _vaults[viewId] != address(0);
    }
}
