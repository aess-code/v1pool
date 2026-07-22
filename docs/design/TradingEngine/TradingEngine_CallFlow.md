# TradingEngine Call Flow

**Stage 4.9 Architecture Freeze**

This document outlines the definitive execution sequence for the primary actions within the Pulse Protocol V1 architecture. It guarantees no circular dependencies and strict adherence to the Minimum Privilege Principle.

## 1. BUY Flow

**Trigger:** User calls `TradingEngine.buy(viewId, side, amountIn)`

1. **Validation (TradingEngine):**
   - Verify `status == ACTIVE`.
   - Verify `amountIn > 0` and `side` is valid.
2. **Pricing Calculation (PriceEngine):**
   - Call `IPriceEngine.quoteBuy(forSupply, againstSupply, reserveBalance, side, amountIn)`.
   - Returns `(sharesOut, newPulseIndex, newReserveBalance)`.
3. **Fee Routing (FeeManager):**
   - Call `IFeeManager.recordFee(viewId, creator, totalFee)`.
   - *State modified:* FeeManager internal ledger.
4. **Fund Routing (MarketVault):**
   - Call `IERC20(token).safeTransferFrom(user, vaultAddress, netAmount)`.
   - Call `IMarketVault(vaultAddress).deposit(netAmount)`.
   - *State modified:* Vault's `totalDeposits`.
5. **State Update (TradingEngine):**
   - Update `MarketState` (supplies, `reserveBalance`, `lastPulseIndex`, `lastTradeTimestamp`).
   - Update `positions[viewId][user].forShares` or `againstShares` += `sharesOut`.
   - Update `positions[viewId][user].lastUpdate`.
6. **TWAP Evaluation (TWAPLibrary):**
   - Call `TWAPLibrary.tryRecordSnapshot(twapState, newPulseIndex, endTime)`.
   - *State modified:* `TWAPState` (if conditions met).
7. **Event Emission (TradingEngine):**
   - Emit `Bought(viewId, user, side, amountIn, sharesOut, newPulseIndex)`.
   - Emit `PulseIndexUpdated`.
   - Emit `TWAPSnapshotRecorded` (if applicable).

## 2. SELL Flow

**Trigger:** User calls `TradingEngine.sell(viewId, side, sharesIn)`

1. **Validation (TradingEngine):**
   - Verify `status == ACTIVE`.
   - Verify `sharesIn > 0` and `positions[viewId][user]` has sufficient balance.
2. **Pricing Calculation (PriceEngine):**
   - Call `IPriceEngine.quoteSell(forSupply, againstSupply, reserveBalance, side, sharesIn)`.
   - Returns `(amountOut, newPulseIndex, newReserveBalance)`.
3. **Fee Routing (FeeManager):**
   - Call `IFeeManager.recordFee(viewId, creator, totalFee)`.
4. **State Update (TradingEngine):**
   - Update `positions[viewId][user]` -= `sharesIn`.
   - Update `MarketState`.
5. **Fund Routing (MarketVault):**
   - Call `IMarketVault(vaultAddress).withdraw(user, netAmountOut)`.
   - *State modified:* Vault's `totalWithdrawals`.
6. **TWAP Evaluation (TWAPLibrary):**
   - Call `TWAPLibrary.tryRecordSnapshot(...)`.
7. **Event Emission (TradingEngine):**
   - Emit `Sold(viewId, user, side, sharesIn, amountOut, newPulseIndex)`.
   - Emit `PulseIndexUpdated`.
   - Emit `TWAPSnapshotRecorded` (if applicable).

## 3. LOCK Flow

**Trigger:** Any user calls `TradingEngine.lockMarket(viewId)`

1. **Validation (TradingEngine):**
   - Verify `status == ACTIVE`.
   - Verify `block.timestamp >= endTime`.
2. **TWAP Finalisation (TWAPLibrary):**
   - Call `TWAPLibrary.finaliseTWAP(twapState)`.
   - *State modified:* `TWAPState.finalTWAP` and `TWAPState.locked`.
3. **State Update (TradingEngine):**
   - Update `MarketState.status = LOCKED`.
4. **Event Emission (TradingEngine):**
   - Emit `TWAPFinalised(viewId, finalTWAP)`.
   - Emit `MarketLocked(viewId, finalTWAP, timestamp)`.
   - Emit `MarketStatusChanged(viewId, ACTIVE, LOCKED)`.

## 4. SETTLEMENT Flow

**Trigger:** Any user calls `SettlementManager.settleMarket(viewId)`

1. **Validation (SettlementManager):**
   - Call `TradingEngine.getMarketStatus(viewId)` to ensure it is `LOCKED`.
2. **State Transition - Start (SettlementManager → TradingEngine):**
   - Call `TradingEngine.setStatusSettlement(viewId)`.
   - *TradingEngine State modified:* `status = SETTLEMENT`.
   - *TradingEngine Emits:* `MarketStatusChanged`.
3. **Result Determination (SettlementManager):**
   - Call `TradingEngine.getFinalTWAP(viewId)`.
   - Calculate outcome (FOR_WINS, AGAINST_WINS, DRAW).
   - *State modified:* SettlementManager internal result mapping.
4. **State Transition - End (SettlementManager → TradingEngine):**
   - Call `TradingEngine.setStatusClaimable(viewId)`.
   - *TradingEngine State modified:* `status = CLAIMABLE`.
   - *TradingEngine Emits:* `MarketStatusChanged`.
5. **Event Emission (SettlementManager):**
   - Emit `MarketSettled(viewId, result, finalTWAP)`.

## 5. CLAIM Flow

**Trigger:** Any user calls `SettlementManager.claimReward(viewId, user)`

1. **Validation (SettlementManager):**
   - Call `TradingEngine.getMarketStatus(viewId)` to ensure it is `CLAIMABLE`.
   - Verify user has not already claimed via `TradingEngine.getPosition(viewId, user)`.
2. **Reward Calculation (SettlementManager):**
   - Read user's winning shares from `TradingEngine`.
   - Read `reserveBalance` from `TradingEngine`.
   - Calculate payout.
3. **State Update (TradingEngine):**
   - *Note: In V1, to strictly isolate responsibilities, TradingEngine's Position struct tracks `claimStatus`. However, since SettlementManager executes the claim, TradingEngine must expose a restricted `markPositionClaimed(viewId, user)` function for SettlementManager, OR SettlementManager tracks claims internally.*
   - **Architecture Freeze Decision:** SettlementManager tracks `hasClaimed[viewId][user]` internally to prevent TradingEngine from needing a reverse dependency on SettlementManager for position updates during claiming. TradingEngine's Position remains read-only during claims.
4. **Fund Routing (MarketVault):**
   - Call `IMarketVault(vaultAddress).settle(user, payoutAmount)`.
   - *State modified:* Vault's `totalSettled`.
5. **Event Emission (SettlementManager):**
   - Emit `RewardClaimed(viewId, user, payoutAmount)`.
