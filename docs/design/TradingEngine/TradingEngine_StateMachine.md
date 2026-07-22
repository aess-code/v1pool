# TradingEngine State Machine

**Stage 4.9 Architecture Freeze**

## 1. State Definitions

| State | Value | Description |
|---|---|---|
| `ACTIVE` | 0 | Market is open for trading. |
| `LOCKED` | 1 | Trading has ceased; TWAP is finalised. Waiting for SettlementManager to begin settlement. |
| `SETTLEMENT` | 2 | SettlementManager is currently executing the settlement logic. |
| `CLAIMABLE` | 3 | Settlement is complete. Users can claim rewards. |

## 2. State Transition Rules

### 2.1 ACTIVE
- **Purpose:** Allow price discovery and position building.
- **Allowed Functions:** `buy()`, `sell()`, `lockMarket()`
- **Forbidden Functions:** `setStatusSettlement()`, `setStatusClaimable()`, SettlementManager actions.
- **Transition Condition:** `block.timestamp >= ViewRecord.endTime` AND `lockMarket()` is called.
- **Next State:** `LOCKED`

### 2.2 LOCKED
- **Purpose:** Freeze market data, finalise TWAP, and prepare for external settlement.
- **Allowed Functions:** `setStatusSettlement()` (ONLY callable by SettlementManager).
- **Forbidden Functions:** `buy()`, `sell()`, `lockMarket()`.
- **Transition Condition:** SettlementManager calls `setStatusSettlement()` at the beginning of its `settleMarket()` execution.
- **Next State:** `SETTLEMENT`

### 2.3 SETTLEMENT
- **Purpose:** Transient state during the execution of `SettlementManager.settleMarket()`. Prevents any concurrent modifications.
- **Allowed Functions:** `setStatusClaimable()` (ONLY callable by SettlementManager).
- **Forbidden Functions:** All user interactions, `buy()`, `sell()`, `lockMarket()`.
- **Transition Condition:** SettlementManager completes its logic and calls `setStatusClaimable()`.
- **Next State:** `CLAIMABLE`

### 2.4 CLAIMABLE
- **Purpose:** Terminal state. Users burn winning shares for Vault Reserve.
- **Allowed Functions:** `SettlementManager.claimReward()` (which reads from TradingEngine but does not change TradingEngine state).
- **Forbidden Functions:** `buy()`, `sell()`, `lockMarket()`, `setStatusSettlement()`, `setStatusClaimable()`.
- **Transition Condition:** None (Terminal state).

## 3. Authority and Enforcement
- **TradingEngine is the ONLY state machine.**
- SettlementManager **MUST NOT** maintain its own copy of the market lifecycle state.
- SettlementManager **MUST** call `TradingEngine.setStatusSettlement()` and `TradingEngine.setStatusClaimable()` to advance the state. It cannot directly mutate the `status` variable.

## 4. Illegal Transitions
- `ACTIVE` → `SETTLEMENT` (Must pass through `LOCKED`)
- `ACTIVE` → `CLAIMABLE`
- `LOCKED` → `ACTIVE` (Irreversible)
- `LOCKED` → `CLAIMABLE` (Must pass through `SETTLEMENT`)
- `SETTLEMENT` → `ACTIVE`
- `SETTLEMENT` → `LOCKED`
- `CLAIMABLE` → Any State (Terminal)
