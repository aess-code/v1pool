// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ISettlementManager } from "../interfaces/ISettlementManager.sol";
import { ITradingEngine }     from "../interfaces/ITradingEngine.sol";
import { IPulseFactory }      from "../interfaces/IPulseFactory.sol";
import { IMarketVault }       from "../interfaces/IMarketVault.sol";
import { MathLibrary }        from "../libraries/MathLibrary.sol";

/// @title SettlementManager
/// @notice Market settlement and reward claim module for Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      SettlementManager is an **Execution-Only** module.
///      It reads the finalised TWAP from TradingEngine and determines the winner.
///      It does NOT recalculate prices, modify trading rules, or hold funds.
///
///      Settlement Flow:
///        1. Market EndTime reached → anyone calls TradingEngine.lockMarket()
///        2. Anyone calls SettlementManager.settleMarket(viewId)
///           → Calls TradingEngine.setStatusSettlement() (LOCKED → SETTLEMENT)
///           → Reads finalTWAP from TradingEngine
///           → Determines result (FOR_WINS / AGAINST_WINS / DRAW)
///           → Stores result
///           → Calls TradingEngine.setStatusClaimable() (SETTLEMENT → CLAIMABLE)
///        3. Users call claimReward(viewId, user)
///           → Reads user position from TradingEngine
///           → Calculates payout
///           → Calls TradingEngine.markPositionClaimed() (Effect)
///           → Calls Vault.settle(user, amount) (Interaction)
///
///      Settlement Rules (fixed per SSOT, immutable):
///        TWAP > 5000 → FOR_WINS
///        TWAP < 5000 → AGAINST_WINS
///        TWAP = 5000 → DRAW (proportional refund)
///
///      ── Security Properties ───────────────────────────────────────────────
///      - settleMarket() is permissionless (anyone may trigger)
///      - claimReward() is permissionless (anyone may trigger for any user)
///      - Payout ALWAYS goes to the position holder (user), never to msg.sender
///      - claimed[viewId][user] prevents double-claim
///      - CEI pattern: markPositionClaimed() called before Vault.settle()
contract SettlementManager is ISettlementManager {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The TWAP value representing a perfectly balanced market (Draw).
    uint256 private constant DRAW_INDEX = 5000;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable Dependencies
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The shared TradingEngine. Source of all market state and position data.
    ITradingEngine public immutable tradingEngine;

    /// @notice The PulseFactory registry. Used to look up Vault addresses.
    IPulseFactory public immutable factory;

    // ─────────────────────────────────────────────────────────────────────────
    // State Variables
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Settlement result per ViewID.
    mapping(uint256 => SettlementResult) private _results;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy the SettlementManager.
    /// @param _tradingEngine Address of the shared TradingEngine.
    /// @param _factory       Address of the PulseFactory registry.
    constructor(address _tradingEngine, address _factory) {
        if (_tradingEngine == address(0) || _factory == address(0)) {
            revert Settlement__InvalidTWAP(0); // reuse as zero-address guard
        }
        tradingEngine = ITradingEngine(_tradingEngine);
        factory       = IPulseFactory(_factory);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISettlementManager
    /// @dev Permissionless. Anyone may trigger settlement once the market is LOCKED.
    ///
    ///      Execution order:
    ///        1. Verify market is LOCKED (not already settled)
    ///        2. Call TradingEngine.setStatusSettlement() — LOCKED → SETTLEMENT
    ///        3. Read finalTWAP from TradingEngine
    ///        4. Determine result
    ///        5. Store result
    ///        6. Call TradingEngine.setStatusClaimable() — SETTLEMENT → CLAIMABLE
    ///        7. Emit MarketSettled
    function settleMarket(uint256 viewId) external override {
        // Check: market must be LOCKED
        ITradingEngine.MarketStatus status = tradingEngine.getMarketStatus(viewId);
        if (status != ITradingEngine.MarketStatus.LOCKED) {
            if (status == ITradingEngine.MarketStatus.CLAIMABLE ||
                status == ITradingEngine.MarketStatus.SETTLEMENT) {
                revert Settlement__AlreadySettled(viewId);
            }
            revert Settlement__MarketNotLocked(viewId);
        }

        // Advance to SETTLEMENT
        tradingEngine.setStatusSettlement(viewId);

        // Read finalised TWAP
        uint256 finalTWAP = tradingEngine.getFinalTWAP(viewId);
        if (finalTWAP == 0) revert Settlement__InvalidTWAP(viewId);

        // Determine result
        SettlementResult result;
        if (finalTWAP > DRAW_INDEX) {
            result = SettlementResult.FOR_WINS;
        } else if (finalTWAP < DRAW_INDEX) {
            result = SettlementResult.AGAINST_WINS;
        } else {
            result = SettlementResult.DRAW;
        }

        // Store result
        _results[viewId] = result;

        // Advance to CLAIMABLE
        tradingEngine.setStatusClaimable(viewId);

        emit MarketSettled(viewId, result, finalTWAP);
    }

    /// @inheritdoc ISettlementManager
    /// @dev Permissionless. Anyone may trigger a claim for any user.
    ///      Payout ALWAYS goes to `user`, never to msg.sender.
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — CLAIMABLE status, user has position, not already claimed
    ///        2. EFFECT — TradingEngine.markPositionClaimed() (prevents double-claim)
    ///        3. INTERACT — Vault.settle(user, amount)
    function claimReward(uint256 viewId, address user) external override {
        // Check: market must be CLAIMABLE
        ITradingEngine.MarketStatus status = tradingEngine.getMarketStatus(viewId);
        if (status != ITradingEngine.MarketStatus.CLAIMABLE) {
            revert Settlement__MarketNotClaimable(viewId);
        }

        // Check: user must not have already claimed
        ITradingEngine.Position memory pos = tradingEngine.getPosition(viewId, user);
        if (pos.claimStatus) {
            revert Settlement__AlreadyClaimed(viewId, user);
        }

        // Check: user must have a position
        if (pos.forShares == 0 && pos.againstShares == 0) {
            revert Settlement__NoPositionToClaim(viewId, user);
        }

        // Calculate payout
        uint256 amount = _calculatePayout(viewId, user, pos);
        if (amount == 0) {
            revert Settlement__NoPositionToClaim(viewId, user);
        }

        // CEI: Mark claimed BEFORE interacting with Vault
        tradingEngine.markPositionClaimed(viewId, user);

        // Interact: release funds from Vault to user
        address vaultAddr = factory.getVault(viewId);
        IMarketVault(vaultAddr).settle(user, amount);

        emit RewardClaimed(viewId, user, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ISettlementManager
    function getSettlementResult(uint256 viewId)
        external
        view
        override
        returns (SettlementResult)
    {
        return _results[viewId];
    }

    /// @inheritdoc ISettlementManager
    function hasClaimed(uint256 viewId, address user)
        external
        view
        override
        returns (bool)
    {
        return tradingEngine.getPosition(viewId, user).claimStatus;
    }

    /// @inheritdoc ISettlementManager
    function getClaimableAmount(uint256 viewId, address user)
        external
        view
        override
        returns (uint256 amount)
    {
        ITradingEngine.MarketStatus status = tradingEngine.getMarketStatus(viewId);
        if (status != ITradingEngine.MarketStatus.CLAIMABLE) return 0;

        ITradingEngine.Position memory pos = tradingEngine.getPosition(viewId, user);
        if (pos.claimStatus) return 0;
        if (pos.forShares == 0 && pos.againstShares == 0) return 0;

        return _calculatePayout(viewId, user, pos);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Calculate the payout for a user based on the settlement result.
    /// @dev Payout logic per SSOT:
    ///
    ///      FOR_WINS:
    ///        Winners (forShares holders) receive a proportional share of the total reserve.
    ///        payout = (userForShares / totalForSupply) * totalReserve
    ///
    ///      AGAINST_WINS:
    ///        Winners (againstShares holders) receive a proportional share of the total reserve.
    ///        payout = (userAgainstShares / totalAgainstSupply) * totalReserve
    ///
    ///      DRAW:
    ///        All holders receive a proportional refund based on their share of total supply.
    ///        payout = (userTotalShares / totalSupply) * totalReserve
    ///
    ///      All calculations use MathLibrary.mulDiv() for overflow-safe 512-bit precision.
    function _calculatePayout(
        uint256 viewId,
        address user,
        ITradingEngine.Position memory pos
    ) internal view returns (uint256 amount) {
        SettlementResult result = _results[viewId];
        ITradingEngine.MarketState memory state = tradingEngine.getMarketState(viewId);
        uint256 totalReserve = state.reserveBalance;

        if (result == SettlementResult.FOR_WINS) {
            if (pos.forShares == 0 || state.forSupply == 0) return 0;
            amount = MathLibrary.mulDiv(pos.forShares, totalReserve, state.forSupply);

        } else if (result == SettlementResult.AGAINST_WINS) {
            if (pos.againstShares == 0 || state.againstSupply == 0) return 0;
            amount = MathLibrary.mulDiv(pos.againstShares, totalReserve, state.againstSupply);

        } else {
            // DRAW: proportional refund
            uint256 totalSupply = state.forSupply + state.againstSupply;
            if (totalSupply == 0) return 0;
            uint256 userShares = pos.forShares + pos.againstShares;
            if (userShares == 0) return 0;
            amount = MathLibrary.mulDiv(userShares, totalReserve, totalSupply);
        }

        (user); // suppress unused warning
    }
}
