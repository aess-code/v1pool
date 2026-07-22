# TradingEngine State Machine

**Stage 4.8 Design Freeze**

## 1. State Definitions

| State | Value | Description |
|---|---|---|
| `ACTIVE` | 0 | Market is open for trading. |
| `LOCKED` | 1 | Trading has ceased; TWAP is finalised. Waiting for Settlement. |
| `SETTLEMENT` | 2 | Market is undergoing settlement calculation. |
| `CLAIMABLE` | 3 | Settlement complete. Users can claim rewards. |

## 2. State Transition Rules

### 2.1 ACTIVE
- **Purpose:** Allow price discovery and position building.
- **Allowed Functions:** `buy()`, `sell()`, `lockMarket()`
- **Forbidden Functions:** `settleMarket()`, `claimReward()`
- **Transition Condition:** `block.timestamp >= ViewRecord.endTime` AND `lockMarket()` is called.
- **Next State:** `LOCKED`

### 2.2 LOCKED
- **Purpose:** Freeze market data, finalise TWAP, and prepare for external settlement.
- **Allowed Functions:** `settleMarket()` (called via SettlementManager)
- **Forbidden Functions:** `buy()`, `sell()`, `lockMarket()`
- **Transition Condition:** Automatically transitions to `SETTLEMENT` during the `settleMarket()` transaction.
- **Next State:** `SETTLEMENT`

### 2.3 SETTLEMENT
- **Purpose:** Transient state during the execution of `SettlementManager.settleMarket()`.
- **Allowed Functions:** Internal state updates by SettlementManager.
- **Forbidden Functions:** All user interactions.
- **Transition Condition:** Successfully completes settlement logic.
- **Next State:** `CLAIMABLE`

### 2.4 CLAIMABLE
- **Purpose:** Terminal state. Users burn winning shares for Vault Reserve.
- **Allowed Functions:** `claimReward()` (via SettlementManager)
- **Forbidden Functions:** `buy()`, `sell()`, `lockMarket()`, `settleMarket()`
- **Transition Condition:** None (Terminal state).

## 3. Illegal Transitions
- `ACTIVE` → `SETTLEMENT` (Must pass through `LOCKED`)
- `LOCKED` → `ACTIVE` (Irreversible)
- `CLAIMABLE` → `ACTIVE` (Irreversible)
