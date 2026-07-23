# Round 2 Fee Architecture Review

**Date:** July 22, 2026  
**Status:** Pending Approval  
**Context:** Round 2 Final Independent Audit

## 1. Current Asset Flow Problem Analysis

The Round 2 Implementation Audit uncovered a critical architecture flaw regarding protocol fee custody and distribution.

**The Current State:**
- During `buy()` and `sell()`, the `TradingEngine` correctly transfers the **gross amount** of settlement tokens into the `MarketVault`.
- The `TradingEngine` calls `FeeManager.recordFee()`, which only increments internal accounting variables (`_pendingCreatorFees`, `_pendingTreasuryFees`, `_pendingTeamFees`).
- However, when a user calls `FeeManager.claimCreatorFee()`, the `FeeManager` attempts to execute `IERC20(token).safeTransfer(creator, amount)` directly from its own contract balance.

**The Failure:**
Because all physical settlement tokens are held inside the `MarketVault`, the `FeeManager` contract holds a balance of zero. Any attempt to claim fees will revert due to insufficient balance.

## 2. Why FeeManager Cannot Directly Hold Funds

According to the Pulse Protocol V1 Master Specification (SSOT):

1. **One View = One Vault:** All collateral for a specific View MUST be held in its dedicated `MarketVault`. Segregating fee collateral into a global `FeeManager` violates the strict isolation principle. If the `FeeManager` held funds globally, a vulnerability in one View could drain fees belonging to another.
2. **Pull-over-Push:** The protocol forbids active token transfers to fee recipients during trades to prevent reentrancy and save gas.
3. **Module Boundaries:** The `FeeManager` is strictly defined as an **accounting-only module**. It manages the ledger of who is owed what, but it is not authorized to act as a custodian of ERC20 tokens.

Therefore, the invariant must be:
`VaultBalance = reserveBalance + unclaimedFees`
The physical tokens must remain in the `MarketVault` until claimed.

## 3. Solution Comparison (Options A, B, and C)

To fix this, the `FeeManager` must instruct the `MarketVault` to release the funds during a claim. Three architectural paths exist:

### Option A: TradingEngine as the Fee Release Router
- **Flow:** `FeeManager` zeros the ledger → calls `TradingEngine.releaseFee(vault, to, amount)` → `TradingEngine` calls `Vault.withdraw(to, amount)`.
- **Pros:** No changes to `MarketVault` constructor or `Protocol_Security_Standard`. The `Vault` continues to only trust `TradingEngine`.
- **Cons:** Violates the Single Responsibility Principle. The `TradingEngine` is designed to orchestrate *trades*, not handle asynchronous fee claims. It couples trade execution logic with fee distribution logic.

### Option B: Direct Vault Access via New `withdrawFee` Function
- **Flow:** `MarketVault` adds an `authorizedFeeManager` immutable field. `FeeManager` zeros the ledger → calls `Vault.withdrawFee(to, amount)`.
- **Pros:** Clean separation of concerns. `FeeManager` directly commands the Vault to release the exact fee amount. `TradingEngine` is kept completely unaware of fee claims.
- **Cons:** Requires modifying the `MarketVault` constructor (adding `_authorizedFeeManager`), which cascades to `MarketVaultFactory`. Requires updating the `Protocol_Security_Standard` to allow `FeeManager` to access the Vault for fee withdrawals.

### Option C: SettlementManager as the Universal Claim Router
- **Flow:** Users call `SettlementManager.claimFee()`. `SettlementManager` queries `FeeManager` to zero the ledger, then calls `Vault.settle(to, amount)`.
- **Pros:** Reuses existing `Vault.settle()` infrastructure. Centralizes all claims (both trade rewards and fees) into the `SettlementManager`.
- **Cons:** Semantically confusing. `SettlementManager` is designed for market resolution (post-EndTime), whereas fees can be claimed at any time (even while ACTIVE).

## 4. Recommended Solution

**Recommendation: Option B (Direct Vault Access via `withdrawFee`)**

Option B is the most robust architectural choice. It ensures that the `FeeManager` remains the sole authority over fee ledgers and distribution, while the `MarketVault` remains the sole custodian. It strictly enforces that the `TradingEngine` only handles trading, and the `SettlementManager` only handles market resolution.

## 5. Impacted Files List

If Option B is approved, the following files will be modified:

1. **`contracts/interfaces/IMarketVault.sol`**: Add `withdrawFee(address to, uint256 amount)`.
2. **`contracts/vault/MarketVault.sol`**: Add `authorizedFeeManager` immutable, update constructor, implement `withdrawFee` with `onlyFeeManager` modifier.
3. **`contracts/interfaces/IFeeManager.sol`**: No signature changes required, but documentation updated.
4. **`contracts/FeeManager.sol`**: Update `claim` functions to call `IMarketVault(vault).withdrawFee(to, amount)` instead of direct `safeTransfer`.
5. **`contracts/factories/MarketVaultFactory.sol`** (if exists): Update deployment parameters to pass `feeManager` address.
6. **`docs/Protocol_Security_Standard.md`**: Update Module Boundaries table to permit `FeeManager` to call `Vault.withdrawFee`.

## 6. Impact on Freezes

- **Storage Layout Freeze:** **NOT IMPACTED.** Immutables do not consume storage slots. `FeeManager` and `TradingEngine` storage remains 100% identical.
- **Interface Freeze:** **IMPACTED.** `IMarketVault.sol` must be updated to include `withdrawFee`.
- **Constructor Freeze:** **IMPACTED.** `MarketVault.sol` constructor must add `_authorizedFeeManager`. (`TradingEngine` constructor remains untouched).
- **Security Standard:** **IMPACTED.** The boundary table must be updated to explicitly allow `FeeManager` to trigger fee withdrawals from the Vault.

## 7. Next Steps

I am pausing all development and will not enter Round 3. Please review this Architecture Review. 

**Awaiting your decision:**
1. Do you approve Option B?
2. Shall I proceed with updating the affected interfaces, contracts, and tests to implement this fix?
