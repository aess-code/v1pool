# TradingEngine Call Flow

**Stage 4.8 Design Freeze**

This document outlines the exact execution sequence for the primary user actions within the `TradingEngine`.

## 1. BUY Flow

**Trigger:** User calls `TradingEngine.buy(viewId, side, amountIn)`

1. **Validation:**
   - `_validateStatus(viewId, ACTIVE)`
   - `_validateAmount(amountIn)`
2. **Pricing Calculation:**
   - Call `IPriceEngine.quoteBuy(forSupply, againstSupply, reserve, side, amountIn)`
   - Receive `(sharesOut, newPulseIndex, newReserve)`
3. **Fee Routing:**
   - Call `IFeeManager.recordFee(viewId, ...)` (Internal fee accounting update)
4. **Fund Routing (Pure Accounting Pattern):**
   - Call `IERC20(token).safeTransferFrom(user, vaultAddress, netAmount)`
   - Call `IMarketVault(vaultAddress).deposit(netAmount)`
5. **State Update:**
   - Update `MarketState` (supplies, reserve, index)
   - Update `positions[viewId][user][side] += sharesOut`
6. **TWAP Evaluation:**
   - Call `TWAPLibrary.tryRecordSnapshot(...)`
7. **Event Emission:**
   - Emit `Bought`, `PulseIndexUpdated`, `SnapshotRecorded` (if applicable)

## 2. SELL Flow

**Trigger:** User calls `TradingEngine.sell(viewId, side, sharesIn)`

1. **Validation:**
   - `_validateStatus(viewId, ACTIVE)`
   - Verify `positions[viewId][user][side] >= sharesIn`
2. **Pricing Calculation:**
   - Call `IPriceEngine.quoteSell(forSupply, againstSupply, reserve, side, sharesIn)`
   - Receive `(amountOut, newPulseIndex, newReserve)`
3. **Fee Routing:**
   - Call `IFeeManager.recordFee(viewId, ...)`
4. **State Update:**
   - Update `MarketState`
   - Update `positions[viewId][user][side] -= sharesIn`
5. **Fund Routing:**
   - Call `IMarketVault(vaultAddress).withdraw(user, netAmountOut)`
6. **TWAP Evaluation:**
   - Call `TWAPLibrary.tryRecordSnapshot(...)`
7. **Event Emission:**
   - Emit `Sold`, `PulseIndexUpdated`, `SnapshotRecorded` (if applicable)

## 3. LOCK Flow

**Trigger:** Any user calls `TradingEngine.lockMarket(viewId)`

1. **Validation:**
   - `_validateStatus(viewId, ACTIVE)`
   - `_validateTime(block.timestamp >= endTime)`
2. **TWAP Finalisation:**
   - Call `TWAPLibrary.finaliseTWAP(...)`
   - Store `finalTWAP` in `TWAPState`
3. **State Update:**
   - Update `MarketState.status = LOCKED`
4. **Event Emission:**
   - Emit `MarketLocked`, `TWAPFinalised`, `MarketStatusChanged`
