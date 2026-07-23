// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITradingEngine } from "./interfaces/ITradingEngine.sol";
import { IPulseFactory }  from "./interfaces/IPulseFactory.sol";
import { IPriceEngine }   from "./interfaces/IPriceEngine.sol";
import { IFeeManager }    from "./interfaces/IFeeManager.sol";
import { IMarketVault }   from "./interfaces/IMarketVault.sol";
import { TWAPLibrary }    from "./libraries/TWAPLibrary.sol";
import { MathLibrary }    from "./libraries/MathLibrary.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TradingEngine
/// @notice The shared trading execution layer of Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      TradingEngine is the **Orchestrator**, not a calculator.
///      It delegates ALL financial computation to external modules:
///        - PriceEngine  → price and share calculation
///        - FeeManager   → fee recording
///        - TWAPLibrary  → snapshot recording and TWAP finalisation
///        - MathLibrary  → safe arithmetic
///
///      TradingEngine NEVER caches or duplicates state owned by other modules.
///      Vault balance is always read live from IMarketVault.balance().
///      Fee balances are always read live from IFeeManager.
///
///      ── Baseline ──────────────────────────────────────────────────────────
///      v1.0.0-architecture-freeze
///
///      ── Stage 5 Round 2 (Post-Audit) ──────────────────────────────────────
///      Trade Execution (buy/sell) with full defensive validation.
contract TradingEngine is ITradingEngine, ReentrancyGuard {

    using SafeERC20 for IERC20;
    using TWAPLibrary for TWAPLibrary.TWAPState;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Protocol fee rate in basis points (1% = 100 bps). Fixed per SSOT.
    uint256 private constant FEE_BPS = 100;

    /// @notice Minimum valid Pulse Index (inclusive). Per protocol: range is [1, 9999].
    uint256 private constant MIN_PULSE_INDEX = 1;

    /// @notice Maximum valid Pulse Index (inclusive). Per protocol: range is [1, 9999].
    uint256 private constant MAX_PULSE_INDEX = 9999;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable Dependencies (Constructor Frozen — Stage 5 Round 1)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The authoritative Factory and Registry for all Views.
    IPulseFactory public immutable factory;

    /// @notice The shared PriceEngine for all CSM price calculations.
    IPriceEngine  public immutable priceEngine;

    /// @notice The shared FeeManager for all protocol fee accounting.
    IFeeManager   public immutable feeManager;

    // ─────────────────────────────────────────────────────────────────────────
    // State Variables (Storage Layout Frozen per Stage 4.9)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Tracks the active pricing and lifecycle status for each market.
    mapping(uint256 => MarketState) public marketStates;

    /// @notice Tracks the TWAP progression for each market.
    /// @dev The TWAPState struct is owned by TradingEngine and operated on by TWAPLibrary.
    mapping(uint256 => TWAPLibrary.TWAPState) public twapStates;

    /// @notice Tracks the internal accounting of user shares and claim status.
    /// @dev mapping(viewId => mapping(user => Position))
    mapping(uint256 => mapping(address => Position)) public positions;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor (Final — Frozen in Round 1)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Initialises the TradingEngine with all immutable protocol dependencies.
    /// @param _factory      Address of the PulseFactory (Registry).
    /// @param _priceEngine  Address of the shared PriceEngine.
    /// @param _feeManager   Address of the shared FeeManager.
    constructor(address _factory, address _priceEngine, address _feeManager) {
        if (_factory     == address(0)) revert TradingEngine__ZeroAddress();
        if (_priceEngine == address(0)) revert TradingEngine__ZeroAddress();
        if (_feeManager  == address(0)) revert TradingEngine__ZeroAddress();
        factory     = IPulseFactory(_factory);
        priceEngine = IPriceEngine(_priceEngine);
        feeManager  = IFeeManager(_feeManager);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions (Round 2 — buy & sell)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ITradingEngine
    /// @dev Implements BUY Flow (CallFlow Section 1).
    ///      Execution order (strict CEI):
    ///        1. Checks (status, amount, side)
    ///        2. PriceEngine quote + defensive validation
    ///        3. FeeManager.recordFee (accounting only, no transfer)
    ///        4. Effects (state updates)
    ///        5. Interactions (Vault transfer + deposit)
    ///        6. TWAP snapshot (after all state settled)
    ///        7. Events
    function buy(uint256 viewId, uint256 side, uint256 amountIn) external nonReentrant returns (uint256 sharesOut) {
        // ── 1. Checks ────────────────────────────────────────────────────────
        _requireStatus(viewId, MarketStatus.ACTIVE);
        if (amountIn == 0) revert TradingEngine__ZeroAmount();
        if (side > 1)      revert TradingEngine__InvalidSide();

        // ── Load state and ViewRecord (minimal fields) ────────────────────────
        MarketState storage state = marketStates[viewId];
        (address creator, address vaultAddr, uint256 endTime) = _getViewFields(viewId);
        if (vaultAddr == address(0)) revert TradingEngine__VaultNotFound(viewId);

        // ── 2. Pricing Calculation (Delegate to PriceEngine) ─────────────────
        uint256 totalFee  = MathLibrary.applyBps(amountIn, FEE_BPS);
        uint256 netAmount = amountIn - totalFee;

        uint256 newPulseIndex;
        uint256 newReserveBalance;
        (sharesOut, newPulseIndex, newReserveBalance) = priceEngine.quoteBuy(
            state.forSupply,
            state.againstSupply,
            state.reserveBalance,
            side,
            netAmount
        );

        // ── 3. Defensive Validation of PriceEngine Output ────────────────────
        // Fix ③: Validate sharesOut, newPulseIndex, newReserveBalance
        if (sharesOut == 0) revert TradingEngine__InvalidPriceEngineOutput(viewId);
        _validatePulseIndex(viewId, newPulseIndex);
        if (newReserveBalance == 0) revert TradingEngine__InvalidReserveBalance(viewId, newReserveBalance);
        // Fix ⑤: Verify reserve does not decrease on a buy (solvency double-check)
        if (newReserveBalance < state.reserveBalance) revert TradingEngine__InvalidReserveBalance(viewId, newReserveBalance);

        // ── 4. Fee Accounting (Delegate to FeeManager — no token transfer) ───
        feeManager.recordFee(viewId, creator, totalFee);

        // ── 5. Effects (Internal State Updates — before Interactions) ─────────
        if (side == 0) {
            state.forSupply += sharesOut;
        } else {
            state.againstSupply += sharesOut;
        }
        state.reserveBalance     = newReserveBalance;
        state.lastPulseIndex     = newPulseIndex;
        state.lastTradeTimestamp = block.timestamp;

        Position storage pos = positions[viewId][msg.sender];
        if (side == 0) {
            pos.forShares += sharesOut;
        } else {
            pos.againstShares += sharesOut;
        }
        pos.lastUpdate = block.timestamp;

        // ── 6. Interactions (External Vault) ──────────────────────────────────
        // User must have approved TradingEngine to pull tokens.
        // Gross amount is transferred user → Vault. Fees reside in Vault until claimed via FeeManager.
        IERC20(IMarketVault(vaultAddr).token()).safeTransferFrom(msg.sender, vaultAddr, amountIn);
        IMarketVault(vaultAddr).deposit(amountIn);

        // ── 7. TWAP Snapshot (Fix ⑥: only records if status is ACTIVE and inside window) ──
        // TWAPLibrary.tryRecordSnapshot internally checks: locked, endTime, window, interval.
        // TradingEngine additional guard: only call if status is still ACTIVE (already enforced by step 1).
        twapStates[viewId].tryRecordSnapshot(newPulseIndex, endTime);

        // ── 8. Events ─────────────────────────────────────────────────────────
        emit Bought(viewId, msg.sender, side, amountIn, sharesOut, newPulseIndex);
        emit PulseIndexUpdated(viewId, newPulseIndex);
    }

    /// @inheritdoc ITradingEngine
    /// @dev Implements SELL Flow (CallFlow Section 2).
    ///      Execution order (strict CEI):
    ///        1. Checks (status, amount, side, position balance)
    ///        2. PriceEngine quote + defensive validation
    ///        3. FeeManager.recordFee (accounting only)
    ///        4. Effects (state updates)
    ///        5. Interactions (Vault withdraw)
    ///        6. TWAP snapshot
    ///        7. Events
    function sell(uint256 viewId, uint256 side, uint256 sharesIn) external nonReentrant returns (uint256 amountOut) {
        // ── 1. Checks ────────────────────────────────────────────────────────
        _requireStatus(viewId, MarketStatus.ACTIVE);
        if (sharesIn == 0) revert TradingEngine__ZeroAmount();
        if (side > 1)      revert TradingEngine__InvalidSide();

        Position storage pos = positions[viewId][msg.sender];
        uint256 userShares = (side == 0) ? pos.forShares : pos.againstShares;
        if (userShares < sharesIn) {
            revert TradingEngine__InsufficientPosition(viewId, msg.sender, side, userShares, sharesIn);
        }

        // ── Load state and ViewRecord (minimal fields) ────────────────────────
        MarketState storage state = marketStates[viewId];
        (address creator, address vaultAddr, uint256 endTime) = _getViewFields(viewId);
        if (vaultAddr == address(0)) revert TradingEngine__VaultNotFound(viewId);

        // ── 2. Pricing Calculation (Delegate to PriceEngine) ─────────────────
        uint256 newPulseIndex;
        uint256 newReserveBalance;
        (amountOut, newPulseIndex, newReserveBalance) = priceEngine.quoteSell(
            state.forSupply,
            state.againstSupply,
            state.reserveBalance,
            side,
            sharesIn
        );

        // ── 3. Defensive Validation of PriceEngine Output ────────────────────
        // Fix ③: Validate amountOut, newPulseIndex, newReserveBalance
        if (amountOut == 0) revert TradingEngine__InvalidPriceEngineOutput(viewId);
        _validatePulseIndex(viewId, newPulseIndex);
        // Fix ⑤: Verify reserve does not increase on a sell (solvency double-check)
        if (newReserveBalance > state.reserveBalance) revert TradingEngine__InvalidReserveBalance(viewId, newReserveBalance);

        // ── 4. Fee Accounting (Delegate to FeeManager — no token transfer) ───
        uint256 totalFee    = MathLibrary.applyBps(amountOut, FEE_BPS);
        uint256 netAmountOut = amountOut - totalFee;
        feeManager.recordFee(viewId, creator, totalFee);

        // ── 5. Effects (Internal State Updates — before Interactions) ─────────
        if (side == 0) {
            pos.forShares -= sharesIn;
        } else {
            pos.againstShares -= sharesIn;
        }
        pos.lastUpdate = block.timestamp;

        if (side == 0) {
            state.forSupply -= sharesIn;
        } else {
            state.againstSupply -= sharesIn;
        }
        state.reserveBalance     = newReserveBalance;
        state.lastPulseIndex     = newPulseIndex;
        state.lastTradeTimestamp = block.timestamp;

        // ── 6. Interactions (External Vault) ──────────────────────────────────
        // Net amount is withdrawn from Vault to the seller. Fee stays in Vault.
        IMarketVault(vaultAddr).withdraw(msg.sender, netAmountOut);

        // ── 7. TWAP Snapshot ──────────────────────────────────────────────────
        twapStates[viewId].tryRecordSnapshot(newPulseIndex, endTime);

        // ── 8. Events ─────────────────────────────────────────────────────────
        emit Sold(viewId, msg.sender, side, sharesIn, amountOut, newPulseIndex);
        emit PulseIndexUpdated(viewId, newPulseIndex);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions (Lifecycle — Module 2)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ITradingEngine
    /// @dev Permissionless — anyone may call once block.timestamp >= endTime.
    ///      Finalises the TWAP via TWAPLibrary and advances status ACTIVE → LOCKED.
    function lockMarket(uint256 viewId) external override nonReentrant {
        _requireViewExists(viewId);
        MarketState storage state = marketStates[viewId];

        // Must be ACTIVE to lock
        if (state.status != MarketStatus.ACTIVE) {
            revert TradingEngine__AlreadyLocked(viewId);
        }

        // Must have reached EndTime
        (, , uint256 endTime) = _getViewFields(viewId);
        if (block.timestamp < endTime) {
            revert TradingEngine__EndTimeNotReached(viewId, block.timestamp, endTime);
        }

        // Finalise TWAP
        uint256 finalTWAP = twapStates[viewId].finaliseTWAP();

        // Advance status
        MarketStatus oldStatus = state.status;
        state.status = MarketStatus.LOCKED;

        emit TWAPFinalised(viewId, finalTWAP);
        emit MarketLocked(viewId, finalTWAP, block.timestamp);
        emit MarketStatusChanged(viewId, oldStatus, MarketStatus.LOCKED);
    }

    /// @inheritdoc ITradingEngine
    /// @dev Only callable by the authorised SettlementManager for this View.
    ///      Advances status LOCKED → SETTLEMENT.
    function setStatusSettlement(uint256 viewId) external override {
        _requireViewExists(viewId);
        _requireAuthorisedSettlement(viewId);

        MarketState storage state = marketStates[viewId];
        if (state.status != MarketStatus.LOCKED) {
            revert TradingEngine__InvalidStatus(viewId, state.status);
        }

        MarketStatus oldStatus = state.status;
        state.status = MarketStatus.SETTLEMENT;

        emit MarketStatusChanged(viewId, oldStatus, MarketStatus.SETTLEMENT);
    }

    /// @inheritdoc ITradingEngine
    /// @dev Only callable by the authorised SettlementManager for this View.
    ///      Advances status SETTLEMENT → CLAIMABLE.
    function setStatusClaimable(uint256 viewId) external override {
        _requireViewExists(viewId);
        _requireAuthorisedSettlement(viewId);

        MarketState storage state = marketStates[viewId];
        if (state.status != MarketStatus.SETTLEMENT) {
            revert TradingEngine__InvalidStatus(viewId, state.status);
        }

        MarketStatus oldStatus = state.status;
        state.status = MarketStatus.CLAIMABLE;

        emit MarketStatusChanged(viewId, oldStatus, MarketStatus.CLAIMABLE);
    }

    /// @inheritdoc ITradingEngine
    /// @dev Only callable by the authorised SettlementManager during claimReward().
    ///      Marks the user's position as claimed to prevent double-claim.
    function markPositionClaimed(uint256 viewId, address user) external override {
        _requireViewExists(viewId);
        _requireAuthorisedSettlement(viewId);
        positions[viewId][user].claimStatus = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc ITradingEngine
    function getMarketState(uint256 viewId) external view returns (MarketState memory state) {
        _requireViewExists(viewId);
        return marketStates[viewId];
    }

    /// @inheritdoc ITradingEngine
    function getMarketStatus(uint256 viewId) external view returns (MarketStatus) {
        _requireViewExists(viewId);
        return marketStates[viewId].status;
    }

    /// @inheritdoc ITradingEngine
    function getPulseIndex(uint256 viewId) external view returns (uint256 pulseIndex) {
        _requireViewExists(viewId);
        uint256 stored = marketStates[viewId].lastPulseIndex;
        return stored == 0 ? MathLibrary.INITIAL_INDEX : stored;
    }

    /// @inheritdoc ITradingEngine
    function getReserve(uint256 viewId) external view returns (uint256 reserve) {
        _requireViewExists(viewId);
        return marketStates[viewId].reserveBalance;
    }

    /// @inheritdoc ITradingEngine
    function getSupply(uint256 viewId) external view returns (uint256 forSupply, uint256 againstSupply) {
        _requireViewExists(viewId);
        MarketState storage s = marketStates[viewId];
        return (s.forSupply, s.againstSupply);
    }

    /// @inheritdoc ITradingEngine
    function getPosition(uint256 viewId, address user) external view returns (Position memory position) {
        _requireViewExists(viewId);
        return positions[viewId][user];
    }

    /// @inheritdoc ITradingEngine
    function getFinalTWAP(uint256 viewId) external view returns (uint256 twap) {
        _requireViewExists(viewId);
        MarketStatus status = marketStates[viewId].status;
        if (status == MarketStatus.ACTIVE) {
            revert TradingEngine__InvalidStatus(viewId, status);
        }
        return twapStates[viewId].finalTWAP;
    }

    /// @inheritdoc ITradingEngine
    function getVaultBalance(uint256 viewId) external view returns (uint256) {
        _requireViewExists(viewId);
        address vaultAddr = factory.getVault(viewId);
        if (vaultAddr == address(0)) revert TradingEngine__VaultNotFound(viewId);
        return IMarketVault(vaultAddr).balance();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Reverts if the caller is not the authorised SettlementManager for the given View.
    /// @dev The SettlementManager address is stored per-View in the Factory registry.
    function _requireAuthorisedSettlement(uint256 viewId) internal view {
        address settlementManager = factory.getView(viewId).settlementManager;
        if (msg.sender != settlementManager) {
            revert TradingEngine__UnauthorisedSettlement();
        }
    }

    /// @notice Reverts if the given ViewID does not exist in the Factory Registry.
    function _requireViewExists(uint256 viewId) internal view {
        if (!factory.exists(viewId)) {
            revert TradingEngine__ViewNotFound(viewId);
        }
    }

    /// @notice Reverts if the market's current status does not match the expected status.
    function _requireStatus(uint256 viewId, MarketStatus expectedStatus) internal view {
        MarketStatus current = marketStates[viewId].status;
        if (current != expectedStatus) {
            if (expectedStatus == MarketStatus.ACTIVE) {
                revert TradingEngine__MarketNotActive(viewId, current);
            } else {
                revert TradingEngine__InvalidStatus(viewId, current);
            }
        }
    }

    /// @notice Validates that a Pulse Index is within the protocol-defined range [1, 9999].
    /// @dev Fix ④: Double-check PriceEngine output. Protocol invariant: index must be in [1, 9999].
    function _validatePulseIndex(uint256 viewId, uint256 index) internal pure {
        if (index < MIN_PULSE_INDEX || index > MAX_PULSE_INDEX) {
            revert TradingEngine__InvalidPriceEngineOutput(viewId);
        }
    }

    /// @notice Returns only the three fields needed from a ViewRecord (Fix ⑦: avoids full struct copy).
    /// @dev Reads creator, vault, and endTime from the Factory. Includes existence check.
    /// @return creator  Address of the View's creator.
    /// @return vault    Address of the View's MarketVault.
    /// @return endTime  Unix timestamp of the View's end time.
    function _getViewFields(uint256 viewId)
        internal
        view
        returns (address creator, address vault, uint256 endTime)
    {
        _requireViewExists(viewId);
        IPulseFactory.ViewRecord memory r = factory.getView(viewId);
        return (r.creator, r.vault, r.endTime);
    }
}
