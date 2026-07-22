# TradingEngine Storage Layout

**Stage 4.9 Architecture Freeze**

This document details the definitive storage architecture of the `TradingEngine`. The design emphasizes complete state encapsulation per `viewId` to ensure the `TradingEngine` functions as the Single Source of Truth (SSOT) for market runtime state.

## 1. Core Structs

### `MarketState`
Stores the continuous pricing state and lifecycle status.

| Type | Name | Description |
|---|---|---|
| `MarketStatus` | `status` | The current lifecycle state (ACTIVE, LOCKED, SETTLEMENT, CLAIMABLE). |
| `uint256` | `reserveBalance` | The virtual reserve balance tracking net collateral in the Vault. |
| `uint256` | `forSupply` | Total shares issued on the FOR side. |
| `uint256` | `againstSupply` | Total shares issued on the AGAINST side. |
| `uint256` | `lastPulseIndex` | The most recently computed Pulse Index (1 - 9999). |
| `uint256` | `lastTradeTimestamp` | Block timestamp of the most recent trade. |

### `Position` (Internal Accounting)
Stores the user's position balance. This replaces any ERC20/ERC1155 tokenization.

| Type | Name | Description |
|---|---|---|
| `uint256` | `forShares` | Number of FOR shares owned by the user. |
| `uint256` | `againstShares` | Number of AGAINST shares owned by the user. |
| `bool` | `claimStatus` | True if the user has already claimed their settlement reward. |
| `uint256` | `lastUpdate` | Block timestamp of the last position change. |

### `TWAPState` (TWAPLibrary Integration)
Stores the time-weighted average price data, fully synchronized with `TWAPLibrary.sol` requirements.

| Type | Name | Description |
|---|---|---|
| `uint256[30]` | `pulseIndexSnapshots` | Fixed-size buffer of Pulse Index snapshots (settlement window only). |
| `uint256[30]` | `timestamps` | Corresponding block timestamps for each snapshot. |
| `uint256` | `count` | Number of valid snapshots currently stored (0–30). |
| `uint256` | `lastSnapshotTime` | Block timestamp of the most recently recorded snapshot. |
| `uint256` | `lastIndexBeforeWindow` | The last Pulse Index recorded BEFORE the settlement window opened (Fallback TWAP). |
| `uint256` | `finalTWAP` | Finalised TWAP value set at lockMarket(). Zero until locked. |
| `bool` | `locked` | Whether the TWAP has been finalised. |

## 2. Storage Mappings

The engine relies on three primary mappings, keyed by `viewId`:

1. **`mapping(uint256 viewId => MarketState) public marketStates;`**
   - Tracks the active pricing and status for each market.
2. **`mapping(uint256 viewId => TWAPState) public twapStates;`**
   - Tracks the TWAP progression for each market.
3. **`mapping(uint256 viewId => mapping(address user => Position)) public positions;`**
   - Tracks the internal accounting of user shares and claim status.

## 3. Upgrade Compatibility
The `TradingEngine` is designed as a shared execution layer. Storage slots are sequentially assigned. No `__gap` variables are included as V1 is not designed to be upgradable via proxies. Any future V2 will deploy a new `TradingEngine` instance.
