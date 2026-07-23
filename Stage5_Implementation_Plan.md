# Stage 5 Implementation Plan

**Target:** `TradingEngine.sol`
**Baseline:** `v1.0.0-architecture-freeze`
**Version:** Final (Updated with Protocol-Level Constraints)

---

## 协议级声明

> **Stage 5 is an implementation stage, not a protocol design stage.**

Stage 5 的唯一目标是将已冻结的协议架构转化为 Solidity 代码。任何设计决策均已在 Stage 4.9 完成并冻结。本阶段不允许对协议进行任何形式的设计变更。

---

## 协议级约束

以下四项约束在整个 Stage 5 期间具有最高执行优先级，高于任何实现便利性考量。

### 约束一：每 Round 完成后必须执行 SSOT Consistency Check

每一个 Round 完成后，除代码审查外，必须额外执行一次 **SSOT Consistency Check**，确认实现没有偏离已冻结的协议定义。

检查范围如下表所示：

| 检查项 | 检查内容 |
|---|---|
| **Master Specification** | 实现行为是否与 SSOT 描述完全一致 |
| **Interface** | 函数签名、返回值、参数是否与 `ITradingEngine.sol` 完全一致 |
| **Storage Layout** | 所有存储变量是否与冻结的 Storage Layout 文档完全一致 |
| **Events** | 所有 `emit` 语句是否与冻结的 Event 定义完全一致（含参数顺序） |
| **Custom Errors** | 所有 `revert` 语句是否使用冻结的 Custom Error，命名无偏差 |
| **State Machine** | 所有状态转换路径是否与冻结的 State Machine 完全一致 |
| **Call Flow** | 调用链顺序是否与冻结的 Call Flow 文档完全一致 |
| **NatSpec** | 所有公开函数是否具备完整且准确的 NatSpec 注释 |

**强制规则：** 如果 SSOT Consistency Check 发现任何实现与冻结定义冲突，**不得继续进入下一 Round**。必须先修正一致性，重新通过检查后方可继续。

### 约束二：Stage 5 严禁修改协议设计

Stage 5 属于协议实现阶段，以下内容被严格禁止：

**禁止新增：**

| 禁止新增的内容 |
|---|
| Interface（接口函数或接口文件） |
| Storage 变量或存储结构 |
| Event |
| Custom Error |
| Market State（生命周期状态） |
| Economic Rule（经济规则） |
| Protocol Behavior（协议行为） |

**禁止修改：**

| 禁止修改的文档 |
|---|
| Master Specification（SSOT） |
| Protocol Freeze Report |
| Architecture Freeze（Stage 4.9 所有冻结文档） |

### 约束三：TradingEngine is an orchestrator, not a calculator

TradingEngine 不允许自行实现任何协议金融计算。所有计算必须调用外部模块，不得复制任何算法。

**禁止自行计算的内容包括但不限于：**
- Price Calculation
- Share Calculation
- Fee Calculation
- Pulse Index Calculation
- TWAP Calculation
- Settlement Calculation

**必须调用的模块：**
- PriceEngine
- FeeManager
- TWAPLibrary
- MathLibrary

### 约束四：TradingEngine must never duplicate protocol state

TradingEngine 不允许缓存或复制任何已经由其他模块维护的数据。所有数据均应从对应模块实时读取，不得维护第二份状态。

**禁止缓存或复制的内容包括但不限于：**
- Pulse Index（除了属于 MarketState 的 lastPulseIndex 外，不应复制 PriceEngine 的计算过程状态）
- Final TWAP（由 TWAPLibrary 管理，TradingEngine 仅存储其结构体供库调用）
- Vault Balance（必须直接读取 `IMarketVault(vault).balance()`）
- Fee Balance（由 FeeManager 管理）

**违规处理流程：** 如果在实现过程中发现现有设计无法实现，或发现 TradingEngine 需要自行计算或缓存上述内容，必须立即暂停开发，输出 **Architecture Review Report**，等待确认，不得自行修改任何协议设计文档。

---

## 开发顺序与模块划分

`TradingEngine` 的实现分为四个逐步递进的 Round，每个 Round 完成后均设置暂停审计点。

### Round 1 — Core Storage & Infrastructure

**实现内容：**

本 Round 的目标是建立 `TradingEngine` 的完整存储基础，不包含任何业务逻辑。

| 实现项 | 说明 |
|---|---|
| 结构体定义 | `MarketState`, `Position`, `TWAPState`，严格对齐 Stage 4.9 冻结的 Storage Layout |
| 存储映射 | `marketStates`, `twapStates`, `positions` 三个 mapping |
| 依赖引入 | `IPulseFactory`, `IPriceEngine`, `IMarketVault`, `IFeeManager`, `TWAPLibrary`, `MathLibrary`, OpenZeppelin `ReentrancyGuard`, `SafeERC20` |
| 构造函数 | 初始化不可变依赖（Factory 地址等），Zero Address 检查 |
| View Functions | `getMarketState`, `getMarketStatus`, `getPulseIndex`, `getReserve`, `getSupply`, `getPosition`, `getFinalTWAP`, `getVaultBalance` |
| 内部辅助函数 | `_validateStatus`, `_validateTime`, `_getViewRecord` |

**测试内容：** 验证构造函数的 Zero Address 检查，验证所有 View 函数在未初始化状态下的返回值，验证存储结构的初始状态。

**完成标准：** 所有存储槽和 View 函数实现完毕，编译无警告，SSOT Consistency Check 全部通过。

**暂停审计点 #1：** 提交代码、存储布局验证、SSOT 检查、单元测试结果及摘要，等待审查后进入 Round 2。

---

### Round 2 — Trade Execution (`buy` & `sell`)

**实现内容：**

本 Round 实现核心交易逻辑，严格遵循 CEI（Checks-Effects-Interactions）模式和冻结的 Call Flow。

| 实现项 | 说明 |
|---|---|
| `buy()` | 完整实现，含 PriceEngine 调用、FeeManager 记账、资金转移、状态更新、TWAP 快照 |
| `sell()` | 完整实现，含 PriceEngine 调用、FeeManager 记账、状态更新、资金提取、TWAP 快照 |
| `nonReentrant` | 所有状态变更函数均加入防重入保护 |

**测试内容：**

| 测试类型 | 测试项 |
|---|---|
| 验证测试 | `buy` 在非 ACTIVE 状态下 revert；`sell` 在 `InsufficientPosition` 时 revert；Zero Amount revert；Invalid Side revert |
| 执行测试 | 正确更新 `MarketState`（supplies, reserve, index）；正确更新 `positions`；正确调用 `Vault.deposit` / `Vault.withdraw`；正确触发 `Bought` / `Sold` / `PulseIndexUpdated` 事件 |
| 返回值测试 | `buy` 返回正确的 `sharesOut`；`sell` 返回正确的 `amountOut` |

**完成标准：** 交易核心逻辑完成，资金与费用的 Pull-over-Push 模型正确，SSOT Consistency Check 全部通过。

**暂停审计点 #2：** 等待审查后进入 Round 3。

---

### Round 3 — Lifecycle Management & Settlement Hooks

**实现内容：**

本 Round 实现市场生命周期管理，以及供 `SettlementManager` 调用的受限状态转换钩子。

| 实现项 | 说明 |
|---|---|
| `lockMarket()` | 验证 `status == ACTIVE` 且 `block.timestamp >= endTime`；调用 `TWAPLibrary.finaliseTWAP`；推进状态至 `LOCKED` |
| `setStatusSettlement()` | 仅限 SettlementManager 调用；推进状态 `LOCKED → SETTLEMENT` |
| `setStatusClaimable()` | 仅限 SettlementManager 调用；推进状态 `SETTLEMENT → CLAIMABLE` |
| `markPositionClaimed()` | 仅限 SettlementManager 调用；标记用户 `claimStatus = true` |
| 权限控制 | 从 Factory 读取 View 对应的 SettlementManager 地址，严格校验 `msg.sender` |

**测试内容：**

| 测试类型 | 测试项 |
|---|---|
| 时间验证 | `lockMarket` 在 `endTime` 前 revert |
| 双重锁定 | `lockMarket` 在已 LOCKED 状态下 revert |
| 权限测试 | 非 SettlementManager 调用 `setStatusSettlement` / `setStatusClaimable` / `markPositionClaimed` 均 revert |
| 非法转换 | 所有非法状态转换路径均 revert |
| TWAP 验证 | `lockMarket` 后 `getFinalTWAP` 返回正确值；零快照回退机制正确触发 |

**完成标准：** 状态机转换路径完全受控，权限验证严密，SSOT Consistency Check 全部通过。

**暂停审计点 #3：** 等待审查后进入 Round 4。

---

### Round 4 — Integration Tests & Invariant Verification

**实现内容：**

本 Round 编写完整的集成测试，并对所有协议不变量进行系统性验证。

| 测试类型 | 测试项 |
|---|---|
| End-to-End 流程 | 完整的 Buy → Sell → Lock → Settle → Claim 流程 |
| TWAP 集成 | 高频交易下的 `tryRecordSnapshot` 触发验证；30 个快照上限验证；零快照回退至 `lastIndexBeforeWindow` |
| Fee 集成 | `FeeManager.recordFee` 收到正确金额 |
| 重入攻击 | 使用 ERC777/callback token 尝试重入 `buy` 和 `sell` |
| 闪电贷抵抗 | 单块内大额 Buy/Sell 不影响 TWAP 结算结果 |
| 极端边界 | 极大供应量（接近 `uint256.max`）、极小流动性场景 |

**验证不变量：**

| 不变量 | 验证方式 |
|---|---|
| `min(ForSupply, AgainstSupply) <= VaultReserve` | 每次交易后断言 |
| `MarketStatus` 只能单向推进 | 所有非法转换路径均 revert |
| 用户无法售出超过持有的 shares | `InsufficientPosition` 正确触发 |
| Vault 余额 >= 协议追踪的净资产 | 与 Vault 的 `_assertInvariant` 联动验证 |

**完成标准：** 所有测试通过，覆盖率目标 100%（Statement / Branch / Function），不变量无一被破坏，SSOT Consistency Check 全部通过。

**暂停审计点 #4（Final）：** 提交最终代码审查，等待 Stage 5 完成确认。

---

## 暂停审计点汇总

| 编号 | 触发时机 | 必须提交的交付物 |
|---|---|---|
| **#1 — Round 1 Complete** | 存储与视图函数实现完毕 | Solidity Code, Storage Layout Verification, SSOT Consistency Check, Unit Test Results, Round 1 Summary |
| **#2 — Round 2 Complete** | 交易逻辑实现完毕 | 同上（针对 Round 2） |
| **#3 — Round 3 Complete** | 生命周期管理实现完毕 | 同上（针对 Round 3） |
| **#4 — Round 4 Complete** | 测试与不变量验证完成 | 同上（针对 Round 4） |

---

## 文件变更范围

本 Stage 5 仅允许新增或修改以下文件：

| 文件 | 操作 |
|---|---|
| `contracts/TradingEngine.sol` | **新增**（唯一实现文件） |
| `test/TradingEngine.test.cjs` | **新增**（测试文件） |

**严格禁止修改以下文件：**

| 文件 | 理由 |
|---|---|
| `contracts/interfaces/*.sol` | Architecture Freeze |
| `docs/design/TradingEngine/*.md` | Architecture Freeze |
| `docs/Pulse_Protocol_V1_Master_Specification*.md` | SSOT，不得修改 |
| 所有已有合约（Vault, PriceEngine, Libraries） | 已完成并审计 |
