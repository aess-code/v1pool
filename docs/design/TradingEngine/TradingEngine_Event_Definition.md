# TradingEngine Event Definition

**Stage 4.8 Design Freeze**

This document outlines the events emitted by the `TradingEngine` to facilitate off-chain indexing, frontend state synchronization, and auditability.

| Event Name | Parameters | Purpose | Emission Trigger |
|---|---|---|---|
| `Bought` | `viewId` (indexed), `user` (indexed), `side`, `amountIn`, `sharesOut` | Tracks user acquisition of position shares. | Successfully completing the `buy()` transaction. |
| `Sold` | `viewId` (indexed), `user` (indexed), `side`, `sharesIn`, `amountOut` | Tracks user liquidation of position shares. | Successfully completing the `sell()` transaction. |
| `PulseIndexUpdated` | `viewId` (indexed), `newIndex` | Tracks the continuous price movement of the market. | After any `buy()` or `sell()` alters the index. |
| `SnapshotRecorded` | `viewId` (indexed), `index`, `timestamp` | Provides an auditable trail of TWAP data points. | When `buy()` or `sell()` triggers `tryRecordSnapshot()` successfully. |
| `MarketLocked` | `viewId` (indexed), `timestamp` | Signals the end of trading for a market. | Successfully completing the `lockMarket()` transaction. |
| `TWAPFinalised` | `viewId` (indexed), `finalTWAP` | Records the definitive price used for settlement. | Inside `lockMarket()`, after the TWAP calculation concludes. |
| `MarketStatusChanged` | `viewId` (indexed), `oldStatus`, `newStatus` | Tracks the lifecycle transitions of the market. | During `lockMarket()` or when SettlementManager updates the state. |
