# Round 2 Final Fix Report & Technical Explanations

**Date:** July 22, 2026  
**Target:** `TradingEngine.sol` Round 2 Final Audit  

This document addresses all technical inquiries (A-F) raised for the Round 2 Final Independent Audit.

---

## A. Custom Error Definitions

The two new defensive Custom Errors were added to `ITradingEngine.sol` to maintain interface consistency without altering protocol behaviour.

**Location in `ITradingEngine.sol`:**
```solidity
/// @notice Thrown when PriceEngine returns an invalid output (zero shares, zero amount, or illegal index).
error TradingEngine__InvalidPriceEngineOutput(uint256 viewId);

/// @notice Thrown when the reserve balance is invalid after a trade (zero or overflow).
error TradingEngine__InvalidReserveBalance(uint256 viewId, uint256 reserve);
```
They are strictly implementation-layer safeguards against external computation errors.

---

## B. PriceEngine Output Validation Logic

The `TradingEngine` now acts as a defensive Orchestrator. It verifies the outputs of `PriceEngine` using the following mathematical logic:

**1. `buy()` Reserve Increase Validation:**
```solidity
if (newReserveBalance < state.reserveBalance) revert TradingEngine__InvalidReserveBalance(viewId, newReserveBalance);
```
**Logic:** A `buy` operation involves a user depositing `amountIn` collateral into the protocol. Mathematically, `newReserve = oldReserve + amountIn`. Since `amountIn > 0` (validated in step 1), the reserve **must strictly increase**. If `newReserveBalance` is less than `state.reserveBalance`, it indicates a severe math bug or underflow in the `PriceEngine`.

**2. `sell()` Reserve Decrease Validation:**
```solidity
if (newReserveBalance > state.reserveBalance) revert TradingEngine__InvalidReserveBalance(viewId, newReserveBalance);
```
**Logic:** A `sell` operation involves the protocol returning `amountOut` collateral to the user. Mathematically, `newReserve = oldReserve - amountOut`. Since `amountOut > 0` (defensively validated), the reserve **must strictly decrease**. If `newReserveBalance` is greater than `state.reserveBalance`, it indicates an overflow or calculation error in the `PriceEngine`.

---

## C. Invariant Test Explanations

### 1. `VaultBalance >= reserve`
**Is it always true?** Yes.
**Why?** 
- In `buy()`, the **gross amount** (`amountIn`) is transferred to the Vault. The `reserveBalance` is updated by `PriceEngine` based on the **net amount** (`amountIn - 1% fee`). Therefore, the Vault receives 100% of the funds, but the `reserveBalance` only tracks 99%. The remaining 1% physically sits in the Vault as accumulated fees.
- In `sell()`, the `reserveBalance` is reduced by the **gross `amountOut`**. However, the Vault only transfers the **net amount** (`amountOut - 1% fee`) to the user. The 1% fee stays in the Vault.
- Thus, at any point: `VaultBalance = reserveBalance + CumulativeUnclaimedFees`. Since fees are $\ge 0$, `VaultBalance >= reserveBalance` is a mathematical certainty.

### 2. `Supply >= Position`
**How is it calculated?**
The global `forSupply` and `againstSupply` in `MarketState` are incremented/decremented identically to the user's `Position` struct during `buy()` and `sell()`. The invariant test verifies that the global supply is always greater than or equal to the sum of all individual user positions.

### 3. FeeManager and Vault Asset Association
`FeeManager` is an **accounting-only** ledger. It records `totalFee` via `recordFee()`. The actual ERC20 tokens representing those fees are never transferred to the `FeeManager`; they are deposited into (or left behind in) the `MarketVault`. 
The invariant test `VaultBalance >= reserve + totalRecordedFees` mathematically links the `FeeManager`'s ledger to the physical assets in the `Vault`.

---

## D. Storage Layout Comparison

**Stage 4.9 Frozen Layout:**
1. `mapping(uint256 => MarketState) public marketStates;`
2. `mapping(uint256 => TWAPState) public twapStates;`
3. `mapping(uint256 => mapping(address => Position)) public positions;`

**Current `TradingEngine.sol` Storage:**
1. `mapping(uint256 => MarketState) public marketStates;`
2. `mapping(uint256 => TWAPLibrary.TWAPState) public twapStates;`
3. `mapping(uint256 => mapping(address => Position)) public positions;`

**Confirmation:**
- **Slot Order:** 100% identical.
- **Mapping Order:** 100% identical.
- **Immutables:** `factory`, `priceEngine`, and `feeManager` are declared as `immutable`. In Solidity, `immutable` variables are embedded directly into the contract bytecode at deploy time and **do not consume storage slots**. They have zero impact on the storage layout.

---

## E. Round 2 Modification Confirmation

During the Round 2 fixes, the following rules were strictly observed:

- **Constructor:** **NOT MODIFIED**. Remains the frozen 3-argument version from Round 1.
- **Immutable Dependencies:** **NOT MODIFIED**.
- **Storage Layout:** **NOT MODIFIED**.
- **Interface Signature:** **NOT MODIFIED**. (Only added two Custom Errors to `ITradingEngine.sol` for defensive reverts).
- **Event Signature:** **NOT MODIFIED**. (Fixed the `PulseIndexUpdated` emission in `TradingEngine.sol` to correctly match the frozen interface signature).

---

## F. Test Execution Summary

A complete execution of the test suite (`REPORT_GAS=true pnpm hardhat test`) yielded the following:

- **Unit Tests:** 29/29 Passing. Full coverage of `buy`/`sell` success paths, ERC20 failures (allowance, balance), Vault failures, invalid PriceEngine outputs, fee routing, and extreme trade boundaries (1 wei, 1,000,000 tokens).
- **Invariant Tests:** 4/4 Passing. Verified `VaultBalance >= reserve`, `Supply >= Positions`, `FeeManager ledger == physical Vault fees`, `PulseIndex \in [1, 9999]`, and capital conservation.
- **Gas Report:** Generated successfully (see `Round2_Gas_Benchmark.md`). `buy()` averages 312,304 gas; `sell()` averages 187,971 gas.

All files are ready for the Final Independent Audit.
