# TradingEngine Storage Layout

**Stage 4.8 Design Freeze**

This document details the storage architecture of the `TradingEngine`. The design emphasizes gas efficiency through struct packing and strict state isolation per `viewId`.

## 1. Core Structs

### `MarketState`
Stores the continuous pricing state and lifecycle status. Packed to fit within a single 256-bit slot.

| Type | Name | Bits | Description |
|---|---|---|---|
| `uint8` | `status` | 8 | The current lifecycle state (0=ACTIVE, 1=LOCKED, etc.). |
| `uint64` | `pulseIndex` | 64 | The current price index (0 - 10000). |
| `uint92` | `forSupply` | 92 | Total shares issued on the FOR side. |
| `uint92` | `againstSupply` | 92 | Total shares issued on the AGAINST side. |

*(Total: 256 bits = 1 slot)*

### `TWAPState`
Stores the time-weighted average price data.

| Type | Name | Bits | Description |
|---|---|---|---|
| `uint64` | `finalTWAP` | 64 | The locked TWAP value (set during `lockMarket`). |
| `uint64` | `lastSnapshotTime` | 64 | Timestamp of the most recent snapshot. |
| `uint64` | `lastSnapshotIndex` | 64 | The index recorded at the last snapshot. |
| `uint64` | `snapshotCount` | 64 | Number of snapshots recorded (max 30). |

*(Total: 256 bits = 1 slot)*

## 2. Storage Mappings

The engine relies on three primary mappings, keyed by `viewId`:

1. **`mapping(uint256 viewId => MarketState) public marketStates;`**
   - Tracks the active pricing and status for each market.
2. **`mapping(uint256 viewId => TWAPState) public twapStates;`**
   - Tracks the TWAP progression for each market.
3. **`mapping(uint256 viewId => mapping(address user => mapping(uint256 side => uint256 shares))) public positions;`**
   - Tracks the internal accounting of user shares. This explicitly replaces ERC20/ERC1155 tokenization.

## 3. Upgrade Compatibility
The `TradingEngine` is designed as a shared execution layer. Storage slots are sequentially assigned. No `__gap` variables are included as V1 is not designed to be upgradable via proxies. Any future V2 will deploy a new `TradingEngine` instance.
