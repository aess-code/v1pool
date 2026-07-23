// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MarketVault } from "../vault/MarketVault.sol";

/// @notice Mock VaultFactory for integration tests.
/// Deploys real MarketVault instances but accepts any caller.
contract MockVaultFactoryForIntegration {
    address public immutable token;
    mapping(uint256 => address) public vaults;

    event VaultDeployed(uint256 indexed viewId, address vault);

    constructor(address _token) {
        token = _token;
    }

    function deployVault(
        uint256 viewId,
        address authorisedEngine,
        address authorisedSettlement
    ) external returns (address vault) {
        require(vaults[viewId] == address(0), "Already deployed");
        MarketVault newVault = new MarketVault(viewId, token, authorisedEngine, authorisedSettlement);
        vault = address(newVault);
        vaults[viewId] = vault;
        emit VaultDeployed(viewId, vault);
    }

    function getVault(uint256 viewId) external view returns (address) {
        return vaults[viewId];
    }
}
