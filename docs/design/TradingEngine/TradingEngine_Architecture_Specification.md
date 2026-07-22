# TradingEngine Architecture Specification

**Stage 4.8 Design Freeze**

## 1. Core Responsibility Definition

`TradingEngine` is the **Shared Execution Layer** of Pulse Protocol V1.

### 1.1 What TradingEngine OWNS (Responsibilities)
- **Position Accounting:** Tracking user shares (FOR/AGAINST) per ViewID.
- **Market State Machine:** Managing the lifecycle (ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE).
- **Price State:** Storing and updating the Pulse Index, For Supply, Against Supply, and Reserve Balance per ViewID.
- **TWAP Orchestration:** Deciding *when* to trigger `TWAPLibrary.tryRecordSnapshot()`.
- **Fund Routing:** Pulling ERC20 tokens from users and pushing them to the `MarketVault` during buys; commanding `MarketVault` to push tokens to users during sells.
- **Fee Routing:** Calculating fees and commanding `FeeManager` to record them.

### 1.2 What TradingEngine NEVER OWNS (Non-Responsibilities)
- **Asset Custody:** NEVER holds ERC20 tokens. All tokens reside in the `MarketVault`.
- **Pricing Math:** NEVER calculates prices. It delegates strictly to `PriceEngine`.
- **TWAP Math:** NEVER calculates the time-weighted average. It delegates strictly to `TWAPLibrary`.
- **Settlement Logic:** NEVER decides who wins or the payout ratio. It delegates to `SettlementManager`.
- **Fee Custody:** NEVER holds fee balances. `FeeManager` handles fee accounting.

## 2. Module Boundaries

| Boundary | Interaction Contract |
|---|---|
| **PulseFactory** | Read-only: Verify `ViewRecord` existence and configuration. |
| **MarketVault** | Write: Call `deposit()` (after routing funds) and `withdraw()`. |
| **MarketVaultFactory**| None: Factory handles vault creation. |
| **PriceEngine** | Read-only (Pure): Pass state, receive `(shares, newIndex, newReserve)`. |
| **MathLibrary** | Internal: Use for safe arithmetic. |
| **TWAPLibrary** | Internal: Use for snapshot recording and finalisation. |
| **FeeManager** | Write: Call `recordFee()`. |
| **SettlementManager** | Read-only: `SettlementManager` reads TWAP from `TradingEngine`. |
| **Frontend** | Interaction: Entry point for `buy()`, `sell()`, `lockMarket()`. |
