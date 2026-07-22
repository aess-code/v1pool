# TradingEngine Interface Specification

**Stage 4.8 Design Freeze**

## 1. External Functions

### `buy(uint256 viewId, uint256 side, uint256 amount)`
- **Visibility:** `external`
- **Access Control:** Public
- **Parameters:**
  - `viewId`: Target market.
  - `side`: `0` (FOR) or `1` (AGAINST).
  - `amount`: USDT amount to spend.
- **Return Values:** `(uint256 sharesOut)`
- **Revert Conditions:**
  - `InvalidStatus` (if not ACTIVE)
  - `InvalidAmount` (if 0)
  - `InvalidSide` (if > 1)
  - `ERC20: transferFrom failed`
- **State Modifications:**
  - Updates `MarketState` (supplies, reserve, index).
  - Updates `positions[viewId][user][side]`.
  - Triggers TWAP snapshot if window/interval met.
- **Events Emitted:** `Bought`, `PulseIndexUpdated`, `SnapshotRecorded` (optional).

### `sell(uint256 viewId, uint256 side, uint256 shares)`
- **Visibility:** `external`
- **Access Control:** Public
- **Parameters:**
  - `viewId`: Target market.
  - `side`: `0` (FOR) or `1` (AGAINST).
  - `shares`: Amount of shares to burn.
- **Return Values:** `(uint256 amountOut)`
- **Revert Conditions:**
  - `InvalidStatus` (if not ACTIVE)
  - `InvalidAmount` (if 0)
  - `InsufficientShares`
- **State Modifications:**
  - Updates `MarketState`.
  - Decrements `positions`.
  - Triggers TWAP snapshot if applicable.
- **Events Emitted:** `Sold`, `PulseIndexUpdated`, `SnapshotRecorded` (optional).

### `lockMarket(uint256 viewId)`
- **Visibility:** `external`
- **Access Control:** Public (Permissionless)
- **Parameters:** `viewId`
- **Return Values:** None
- **Revert Conditions:**
  - `InvalidStatus` (if not ACTIVE)
  - `InvalidTime` (if `block.timestamp < endTime`)
- **State Modifications:**
  - Sets state to `LOCKED`.
  - Finalises TWAP via `TWAPLibrary`.
- **Events Emitted:** `MarketLocked`, `TWAPFinalised`.

### `setMarketStatus(uint256 viewId, MarketStatus newStatus)`
- **Visibility:** `external`
- **Access Control:** `onlySettlementManager`
- **Parameters:** `viewId`, `newStatus`
- **Return Values:** None
- **Revert Conditions:** `Unauthorized`, Invalid transition.
- **State Modifications:** Updates state to `SETTLEMENT` or `CLAIMABLE`.

## 2. View Functions
- `getMarketState(uint256 viewId) returns (MarketState memory)`
- `getPosition(uint256 viewId, address user, uint256 side) returns (uint256)`
- `getTWAP(uint256 viewId) returns (uint256)`
