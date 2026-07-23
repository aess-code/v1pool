# TradingEngine Readiness Audit

本审计从独立安全审计员的视角出发，针对 TradingEngine 在进入 Stage 5 实现前的准备状态进行评估。

## 审计问题答复

基于对代码库的深入分析，以下是对关键安全与架构问题的正式答复：

**1. TradingEngine 是否还有隐藏职责？**
目前没有发现隐藏职责，但其职责边界在文档与接口间存在定义上的冲突。具体而言，SSOT 规定 TradingEngine 负责维护储备金（Reserve Balance）状态，但在存储布局设计文档中并未体现该字段。此外，TWAP 的完整状态管理在库与存储文档间存在严重脱节，这可能导致实现时职责不清。

**2. 是否存在两个模块共同维护同一状态？**
理论设计上不存在，但在接口层面存在潜在风险。`TradingEngine` 是单一状态管理者，但 `ISettlementManager` 的接口定义中包含了“转换市场状态至 CLAIMABLE”的语义。如果 `SettlementManager` 在执行结算时试图直接干预市场状态机的推进，而不是通过回调或受限的接口触发，则可能破坏单一状态管理原则。

**3. 是否存在未来容易形成循环依赖的位置？**
在目前的架构设计中，`TradingEngine` 调用 `MarketVault` 和 `PriceEngine`，这两个模块均不回调 `TradingEngine`。然而，`SettlementManager` 需要读取 `TradingEngine` 的最终 TWAP，并且（根据接口定义）需要更新 `TradingEngine` 的状态至 `CLAIMABLE`。这种交互模式如果处理不当，特别是在复杂的结算逻辑中，可能会引发逻辑上的循环依赖或重入风险。

**4. TradingEngine 是否已经成为协议唯一状态管理者（Single State Authority）？**
在 SSOT 层面，是的。但在当前的冻结产物中，由于存储布局文档的遗漏（如 `reserveBalance` 的缺失）以及接口定义的不一致（缺少统一的状态管理接口），它作为唯一权威的地位在实现规范上是不完整的。

**5. Position 是否只存在于 TradingEngine？**
是的。审计确认 `MarketVault` 和其他任何模块均不包含用户头寸（Position Shares）的存储或管理逻辑。头寸作为内部记账仅存在于 `TradingEngine` 中。

**6. Vault 是否仍然保持完全资金托管，不参与任何业务逻辑？**
是的。`MarketVault.sol` 的实现严格遵守了这一原则，仅暴露了受限的 `deposit`、`withdraw` 和 `settle` 方法，不包含任何定价、头寸或市场生命周期的业务逻辑。

**7. PriceEngine 是否仍然保持 Zero Storage、Pure Calculation？**
是的。`PriceEngine.sol` 的实现确认了其无状态的特性，完全依赖于传入的参数进行纯粹的数学计算。

**8. SettlementManager 是否仍然只是执行结算，而不是重新计算业务逻辑？**
设计意图如此，但接口层面的模糊性需要警惕。它读取 TWAP 并决定胜负，这符合预期。但其对市场状态机（推进至 CLAIMABLE）的干预权需要在实现 `TradingEngine` 时进行严格的权限控制，以防止其越权修改其他业务逻辑。

**9. 整个调用链是否仍然满足无反向依赖？**
当前的设计和已实现的模块（如 Vault 和 PriceEngine）满足调用链单向流动的要求。但在 `TradingEngine` 和 `SettlementManager` 之间的交互（尤其是状态更新的回调）需要特别关注，以确保不会引入反向依赖。

## 审计结论

虽然核心的隔离原则（如 Vault 和 PriceEngine 的纯粹性）得到了保持，但 **TradingEngine 本身的设计冻结产物（接口、存储文档）内部存在严重冲突，且与 SSOT 不完全一致**。

这些不一致直接影响了 TradingEngine 作为单一状态管理者的实现基础，因此，在解决这些问题之前，不建议直接进入编码阶段。
