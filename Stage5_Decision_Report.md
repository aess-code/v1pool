# Stage 5 Go/No-Go Decision Report

## 最终决策

**NO GO**

## 阻塞问题详细说明

在执行 Stage 4.8 冻结验证及 TradingEngine Readiness Audit 后，发现以下严重阻塞问题，必须在进入 Stage 5（编写 Solidity 代码）之前解决。所有问题均源于当前的 `ITradingEngine.sol` 接口及相关设计文档与 Master Specification (SSOT) 的冲突。

### 1. 接口定义与设计文档的严重冲突
实际的 `contracts/interfaces/ITradingEngine.sol` 与冻结文档 `docs/design/TradingEngine/TradingEngine_Interface_Specification.md` 存在显著不一致：
*   **返回值缺失**：`buy` 和 `sell` 函数在实际接口中没有返回值，而设计文档明确要求返回 `sharesOut` 和 `amountOut`。这直接影响前端集成和外部合约调用。
*   **状态更新接口不匹配**：设计文档规定了通用的 `setMarketStatus` 接口供 SettlementManager 调用，而实际接口中仅存在特定于单一状态的 `setStatusClaimable`。
*   **View 函数定义分歧**：设计文档中定义的 Getter 函数（如 `getMarketState`, `getPosition`, `getTWAP`）在实际接口中被替换为另一套不同的函数（如 `getPulseIndex`, `getVaultBalance`, `getSupply` 等）。
*   **事件定义合并**：设计文档要求分别触发 `Bought` 和 `Sold` 事件，而实际接口将其合并为单一的 `TradeExecuted` 事件。

### 2. 存储布局设计的不完整
`docs/design/TradingEngine/TradingEngine_Storage_Layout.md` 中定义的存储结构未能满足 SSOT 的要求：
*   **`MarketState` 缺失 `reserveBalance`**：SSOT 明确指出 TradingEngine 必须管理 `reserveBalance` 状态，但当前的存储布局中该字段缺失。
*   **`TWAPState` 与库实现脱节**：存储文档中的 `TWAPState` 结构过于简单，未包含 `TWAPLibrary.sol` 实际运行所需的快照数组（`pulseIndexSnapshots` 和 `timestamps`）以及 `lastIndexBeforeWindow` 等关键回退状态字段。

### 3. 生命周期与状态机边界模糊
*   `ISettlementManager.sol` 的接口注释暗示其主动“转换市场状态至 CLAIMABLE”，这与 TradingEngine 作为唯一状态管理者的定位存在潜在的权限冲突风险。需要明确 SettlementManager 是通过调用 TradingEngine 的暴露接口（如 `setStatusClaimable`）来触发状态变更，而不是直接越权管理状态。

## 修复方案建议

为了能够顺利推进到 Stage 5，必须执行以下修复步骤：

1.  **统一接口定义**：根据 SSOT 的原则，决定是以 `ITradingEngine.sol` 的当前实现为准，还是以设计文档为准，并对另一方进行更新以消除冲突。
2.  **修正存储布局文档**：更新 `TradingEngine_Storage_Layout.md`，补全 `reserveBalance` 字段，并确保 `TWAPState` 的定义与 `TWAPLibrary.sol` 中的要求完全一致。
3.  **澄清状态机边界**：在相关文档中明确说明 SettlementManager 只能通过调用 TradingEngine 提供的受限接口来触发状态机的最后一步转换，确保单一状态管理原则不被破坏。

在上述阻塞问题得到您的确认并修复之前，不应开始编写任何 `TradingEngine` 的实现代码。
