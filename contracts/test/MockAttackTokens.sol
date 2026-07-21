// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// MockFeeOnTransferToken
// A token that deducts a 5% fee on every transfer.
// Used to test that MarketVault detects accounting drift and reverts.
// ─────────────────────────────────────────────────────────────────────────────
contract MockFeeOnTransferToken is ERC20 {
    constructor() ERC20("FeeToken", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Override transferFrom to deduct 5% fee (sent to address(0) / burned).
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        uint256 fee     = amount / 20; // 5%
        uint256 netAmount = amount - fee;
        // Burn the fee
        _burn(from, fee);
        // Transfer net amount
        return super.transferFrom(from, to, netAmount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockRebasingToken
// A token whose balances can be slashed externally (simulating negative rebase).
// Used to test that MarketVault detects balance < trackedNetAssets and reverts.
// ─────────────────────────────────────────────────────────────────────────────
contract MockRebasingToken is ERC20 {
    constructor() ERC20("RebaseToken", "REBASE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Slash (burn) tokens from any address — simulates a negative rebase event.
    function slash(address account, uint256 amount) external {
        _burn(account, amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockReentrantToken
// A token that attempts to call vault.withdraw() inside its transfer() hook.
// Used to test that ReentrancyGuard blocks the reentrant call on withdraw().
// ─────────────────────────────────────────────────────────────────────────────
interface IVaultWithdraw {
    function withdraw(address to, uint256 amount) external;
}

contract MockReentrantToken is ERC20 {
    address public vault;
    address public target;
    uint256 public reentrantAmount;
    bool    private _attacking;

    constructor() ERC20("ReentrantToken", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setVaultAndTarget(address _vault, address _target, uint256 _amount) external {
        vault           = _vault;
        target          = _target;
        reentrantAmount = _amount;
    }

    /// @dev On transfer, attempt to reenter vault.withdraw().
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (vault != address(0) && !_attacking) {
            _attacking = true;
            // Attempt reentrancy — should be blocked by ReentrancyGuard
            try IVaultWithdraw(vault).withdraw(target, reentrantAmount) {} catch {}
            _attacking = false;
        }
        return super.transfer(to, amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockReentrantSettleToken
// A token that attempts to call vault.settle() inside its transfer() hook.
// Used to test that ReentrancyGuard blocks the reentrant call on settle().
// ─────────────────────────────────────────────────────────────────────────────
interface IVaultSettle {
    function settle(address to, uint256 amount) external;
}

contract MockReentrantSettleToken is ERC20 {
    address public vault;
    address public settlementCaller;
    address public target;
    uint256 public reentrantAmount;
    bool    private _attacking;

    constructor() ERC20("ReentrantSettleToken", "REENTS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setVaultAndTarget(
        address _vault,
        address _settlementCaller,
        address _target,
        uint256 _amount
    ) external {
        vault             = _vault;
        settlementCaller  = _settlementCaller;
        target            = _target;
        reentrantAmount   = _amount;
    }

    /// @dev On transfer, attempt to reenter vault.settle().
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (vault != address(0) && !_attacking) {
            _attacking = true;
            try IVaultSettle(vault).settle(target, reentrantAmount) {} catch {}
            _attacking = false;
        }
        return super.transfer(to, amount);
    }
}
