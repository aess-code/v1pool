# Stage 5 Round 1 Summary: Core Storage & Infrastructure (Post-Optimisation)

**Date:** July 22, 2026
**Target:** `TradingEngine.sol`
**Status:** Audit Pause Point #1 Reached (All Suggestions Applied)

## 1. Implementation Overview & Optimisations Applied

Round 1 implementation is complete. All six suggested optimisations have been successfully applied without modifying any protocol design or architecture freeze baselines:

1. **Constructor Frozen (High):** The constructor now explicitly injects `factory`, `priceEngine`, and `feeManager` as immutable dependencies. This permanently freezes the constructor for the remainder of Stage 5. `VaultFactory` is not needed as an immutable dependency because Vaults are queried dynamically from the `factory` via `getVault(viewId)`.
2. **Custom Errors Unified (Medium):** The generic `revert("Not implemented")` strings have been replaced with the custom error `TradingEngine__NotImplemented()`.
3. **View Logic Encapsulated (Medium):** The repetitive `factory.exists(viewId)` checks have been centralized into an internal helper `_requireViewExists(viewId)`, streamlining all View Functions.
4. **Error Renaming (Medium):** The zero-address check for Vault lookup has been updated to use a more semantically accurate `TradingEngine__VaultNotFound(viewId)` error.
5. **NatSpec Completed (Low):** Comprehensive `@param` and `@return` NatSpec tags have been added to all external and public View Functions.
6. **TWAPLibrary using Declaration (Low):** `using TWAPLibrary for TWAPLibrary.TWAPState;` has been added at the contract level to prepare for Round 2 and 3 implementations.

## 2. Storage Layout Verification
**Result: PASS**
The implemented storage strictly adheres to `TradingEngine_Storage_Layout.md` frozen in Stage 4.9.
- `MarketState` struct includes `status`, `reserveBalance`, `forSupply`, `againstSupply`, `lastPulseIndex`, and `lastTradeTimestamp`.
- `Position` struct includes `forShares`, `againstShares`, `claimStatus`, and `lastUpdate`.
- `TWAPState` is imported directly from `TWAPLibrary.sol`, ensuring 100% alignment with the library's required storage format.

## 3. SSOT Consistency Check
**Result: PASS**
- **Master Specification (Constraint #3):** The TradingEngine does not calculate any financial values itself. It delegates entirely to the immutable `priceEngine` and `feeManager`.
- **State Duplication (Constraint #4):** The TradingEngine does not cache `VaultBalance` or `FeeBalance`, strictly fetching `VaultBalance` directly from the `IMarketVault` via `getVaultBalance()`.
- **Interfaces:** All function signatures and return values match `ITradingEngine.sol` exactly.

## 4. Unit Test Results
**Result: PASS (18/18 Passing)**
The test suite (`test/TradingEngine.test.cjs`) was updated to accommodate the new 3-argument constructor. Mock contracts for `IPriceEngine` and `IFeeManager` were added.
- Constructor validation (Zero address checks for all three dependencies) passed.
- `_requireViewExists` correctly reverts on non-existent ViewIDs with `TradingEngine__ViewNotFound`.
- All View functions return the correct default values for a newly initialized market.
- All stubbed functions correctly revert with `TradingEngine__NotImplemented`.

## 5. Next Steps
The constructor is fully frozen and will not be modified in subsequent rounds. The No Backward Modification Rule is in effect. 

Awaiting final independent review. Upon approval, we will proceed to **Round 2: Trade Execution (`buy` & `sell`)**.
