# TradingEngine Test Plan

**Stage 4.8 Design Freeze**

This document outlines the testing strategy for Stage 5 implementation of the `TradingEngine`. Every function must have corresponding tests before implementation is considered complete.

## 1. Unit Tests

| Component | Target | Expected Behavior |
|---|---|---|
| `buy()` | Validation | Reverts on `InvalidStatus`, `InvalidAmount`, `InvalidSide`. |
| `buy()` | Execution | Correctly updates `MarketState`, mints `positions`, transfers ERC20, calls `Vault.deposit()`. |
| `sell()` | Validation | Reverts on `InvalidStatus`, `InsufficientShares`. |
| `sell()` | Execution | Correctly updates `MarketState`, burns `positions`, calls `Vault.withdraw()`. |
| `lockMarket()` | Time Validation | Reverts if `block.timestamp < endTime`. |
| `lockMarket()` | Execution | Transitions state to `LOCKED`, finalises TWAP. |

## 2. Integration Tests

- **End-to-End Trade Flow:** `User` → `TradingEngine` → `PriceEngine` → `MarketVault` (Verify pure-accounting deposit flow).
- **TWAP Integration:** Verify `tryRecordSnapshot()` triggers correctly during high-frequency trading and handles 0-snapshot fallbacks.
- **Fee Integration:** Verify `IFeeManager.recordFee()` receives the correct amounts.

## 3. State Machine Tests

- Verify all illegal transitions revert (e.g., `ACTIVE` → `SETTLEMENT` without `LOCKED`).
- Verify function access controls per state (e.g., `buy()` fails in `LOCKED`).

## 4. Attack Simulations & Boundary Tests

- **Reentrancy:** Attempt to reenter `buy()` and `sell()` using ERC777/callback tokens.
- **Double Lock:** Attempt to call `lockMarket()` twice.
- **Flash Loan Resistance:** Execute massive buy/sell within a single block; verify TWAP is unaffected.
- **Zero Values:** Test zero amounts, zero shares, zero duration markets.

## 5. Coverage Targets

- **Statement Coverage:** 100%
- **Branch Coverage:** 100%
- **Function Coverage:** 100%
