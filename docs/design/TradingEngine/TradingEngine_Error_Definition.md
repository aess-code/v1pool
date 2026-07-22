# TradingEngine Error Definition

**Stage 4.8 Design Freeze**

This document defines the custom errors used by the `TradingEngine` to ensure gas-efficient and descriptive failure modes.

| Error Name | Parameters | Trigger Condition | Caller Expectation |
|---|---|---|---|
| `Engine__InvalidStatus` | `viewId`, `current`, `expected` | An action is attempted in an incompatible market state (e.g., `buy()` while `LOCKED`). | Check `getMarketState()` before transacting. |
| `Engine__InvalidTime` | `viewId`, `currentTime`, `endTime` | `lockMarket()` is called before `endTime`. | Wait until `block.timestamp >= endTime`. |
| `Engine__InvalidAmount` | None | `amountIn` or `sharesIn` is zero. | Provide a non-zero input amount. |
| `Engine__InvalidSide` | `side` | `side` is not 0 (FOR) or 1 (AGAINST). | Pass exactly 0 or 1. |
| `Engine__InsufficientShares` | `user`, `side`, `balance`, `requested` | User attempts to `sell()` more shares than they own. | Query `getPosition()` to verify balance. |
| `Engine__Unauthorized` | `caller`, `expected` | A restricted function is called by an unauthorized address (e.g., `setMarketStatus`). | Only the designated `SettlementManager` may call. |
| `Engine__ZeroAddress` | None | Factory or Vault addresses are zero during initialization. | Protocol configuration error; contact admins. |
| `Engine__InvalidView` | `viewId` | Interaction with an unregistered or non-existent `viewId`. | Query `PulseFactory` to verify View existence. |
