import React, { useState, useMemo } from "react";
import { parseUnits, formatUnits, Address } from "viem";
import { 
  useAccount, 
  useReadContract, 
  useWriteContract, 
  useWaitForTransactionReceipt 
} from "wagmi";

// ================= 1. 合约配置区（请替换为您在 Sepolia 部署的真实地址） =================
const MARKET_CONTRACT_ADDRESS: Address = "0xYourMarketContractAddressHere";
const USDT_CONTRACT_ADDRESS: Address = "0xYourSepoliaUsdtAddressHere";

// 简化的 ERC20 & Market ABI
const USDT_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const MARKET_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserPosition",
    // 假设返回：[yesBalance, noBalance, yesValue, noValue]
    outputs: [
      { name: "yesBal", type: "uint256" },
      { name: "noBal", type: "uint256" },
      { name: "yesVal", type: "uint256" },
      { name: "noVal", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "isYes", type: "bool" },
      { name: "usdtAmount", type: "uint256" },
    ],
    name: "buyShares",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "isYes", type: "bool" },
      { name: "sharesAmount", type: "uint256" },
    ],
    name: "sellShares",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ================= 2. 主组件 =================
export default function TradingPanel() {
  const { address } = useAccount();

  // 组件状态
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState<string>("");

  // 写合约 Hook
  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // ----------------- 读取用户 USDT 余额 (6 decimals) -----------------
  const { data: usdtBalance } = useReadContract({
    address: USDT_CONTRACT_ADDRESS,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // ----------------- 读取用户授权额度 (6 decimals) -----------------
  const { data: usdtAllowance } = useReadContract({
    address: USDT_CONTRACT_ADDRESS,
    abi: USDT_ABI,
    functionName: "allowance",
    args: address ? [address, MARKET_CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  // ----------------- 读取用户持仓 (Shares: 18 decimals, Value: 6 decimals) -----------------
  const { data: userPosition } = useReadContract({
    address: MARKET_CONTRACT_ADDRESS,
    abi: MARKET_ABI,
    functionName: "getUserPosition",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // ----------------- 格式化计算展示数据 -----------------
  const formattedUsdtBalance = useMemo(() => {
    if (!usdtBalance) return "0.00";
    // ⚠️ USDT 采用 6 decimals 格式化
    return Number(formatUnits(usdtBalance, 6)).toFixed(2);
  }, [usdtBalance]);

  const formattedPosition = useMemo(() => {
    if (!userPosition) {
      return {
        yesBalStr: "0.00",
        noBalStr: "0.00",
        yesValStr: "0.00",
        noValStr: "0.00",
        rawYesBal: 0n,
        rawNoBal: 0n,
      };
    }

    const [yb, nb, yv, nv] = userPosition;

    return {
      rawYesBal: yb,
      rawNoBal: nb,
      // ⚠️ 重点修正：YES/NO 份额 Token 是 18 decimals
      yesBalStr: Number(formatUnits(yb, 18)).toFixed(2),
      noBalStr: Number(formatUnits(nb, 18)).toFixed(2),
      // ⚠️ 结算/价值 USDT 是 6 decimals
      yesValStr: Number(formatUnits(yv, 6)).toFixed(2),
      noValStr: Number(formatUnits(nv, 6)).toFixed(2),
    };
  }, [userPosition]);

  // ----------------- MAX 按钮填充逻辑 -----------------
  const handleMax = () => {
    if (tab === "buy") {
      setAmount(formattedUsdtBalance);
    } else {
      // 卖出模式下，根据选中的 YES/NO 填充对应的 18 位精度 Shares 数量
      const maxShares = side === "yes" ? formattedPosition.yesBalStr : formattedPosition.noBalStr;
      setAmount(maxShares);
    }
  };

  // ----------------- 判断是否需要先授权 USDT -----------------
  const needsApproval = useMemo(() => {
    if (tab !== "buy" || !amount || Number(amount) <= 0) return false;
    try {
      // 买入输入的数量按照 6 decimals 解析
      const parsedInput = parseUnits(amount, 6);
      return (usdtAllowance ?? 0n) < parsedInput;
    } catch {
      return false;
    }
  }, [tab, amount, usdtAllowance]);

  // ----------------- 提交授权/交易 -----------------
  const handleAction = async () => {
    if (!amount || Number(amount) <= 0) return;

    try {
      if (needsApproval) {
        // 授权 USDT (6 decimals)
        const approveAmount = parseUnits(amount, 6);
        writeContract({
          address: USDT_CONTRACT_ADDRESS,
          abi: USDT_ABI,
          functionName: "approve",
          args: [MARKET_CONTRACT_ADDRESS, approveAmount],
        });
      } else if (tab === "buy") {
        // 买入：输入单位是 USDT (6 decimals)
        const buyAmount = parseUnits(amount, 6);
        writeContract({
          address: MARKET_CONTRACT_ADDRESS,
          abi: MARKET_ABI,
          functionName: "buyShares",
          args: [side === "yes", buyAmount],
        });
      } else {
        // 卖出：输入单位是 Shares (18 decimals)
        const sellAmount = parseUnits(amount, 18);
        writeContract({
          address: MARKET_CONTRACT_ADDRESS,
          abi: MARKET_ABI,
          functionName: "sellShares",
          args: [side === "yes", sellAmount],
        });
      }
    } catch (err) {
      console.error("交易提交失败:", err);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-5 bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-xl font-sans">
      {/* 1. 买/卖 模式切换页签 */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl mb-4">
        <button
          type="button"
          onClick={() => { setTab("buy"); setAmount(""); }}
          className={`py-2 text-sm font-semibold rounded-lg transition-all ${
            tab === "buy" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => { setTab("sell"); setAmount(""); }}
          className={`py-2 text-sm font-semibold rounded-lg transition-all ${
            tab === "sell" ? "bg-rose-600 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          Sell
        </button>
      </div>

      {/* 2. YES / NO 方向选择器 */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          type="button"
          onClick={() => setSide("yes")}
          className={`py-2.5 px-4 rounded-xl border flex items-center justify-between transition-all ${
            side === "yes"
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
              : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"
          }`}
        >
          <span className="font-bold">YES</span>
          <span className="text-xs opacity-75">
            {formattedPosition.yesBalStr} Shares
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSide("no")}
          className={`py-2.5 px-4 rounded-xl border flex items-center justify-between transition-all ${
            side === "no"
              ? "border-rose-500 bg-rose-500/10 text-rose-400"
              : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700"
          }`}
        >
          <span className="font-bold">NO</span>
          <span className="text-xs opacity-75">
            {formattedPosition.noBalStr} Shares
          </span>
        </button>
      </div>

      {/* 3. 输入区域与余额/持仓展示 */}
      <div className="space-y-2 mb-6">
        <div className="flex justify-between items-center text-xs text-slate-400 px-1">
          <span>
            {tab === "buy"
              ? "Amount to buy (USDT)"
              : `Amount to sell (${side.toUpperCase()} Shares)`}
          </span>

          {/* 余额/持仓快捷提示 & 点击填充 MAX */}
          <button
            type="button"
            onClick={handleMax}
            className="text-emerald-400 hover:underline cursor-pointer transition-colors"
          >
            {tab === "buy" ? (
              `Balance: ${formattedUsdtBalance} USDT`
            ) : (
              `Position: ${side === "yes" ? formattedPosition.yesBalStr : formattedPosition.noBalStr} ${side.toUpperCase()} (≈ $${side === "yes" ? formattedPosition.yesValStr : formattedPosition.noValStr} USDT)`
            )}
          </button>
        </div>

        {/* 动态数量输入框 */}
        <div className="relative flex items-center">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none rounded-xl py-3 pl-4 pr-16 text-lg font-mono text-white placeholder-slate-600 transition-colors"
          />
          <button
            type="button"
            onClick={handleMax}
            className="absolute right-3 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded text-slate-300 transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      {/* 4. 提交按钮 */}
      <button
        type="button"
        disabled={isPending || isConfirming || !amount || Number(amount) <= 0}
        onClick={handleAction}
        className={`w-full py-3.5 rounded-xl font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
          needsApproval
            ? "bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-amber-500/20"
            : tab === "buy"
            ? "bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20"
            : "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20"
        }`}
      >
        {isPending || isConfirming
          ? "Processing..."
          : needsApproval
          ? "Approve USDT"
          : tab === "buy"
          ? `Buy ${side.toUpperCase()}`
          : `Sell ${side.toUpperCase()}`}
      </button>

      {/* 5. 交易确认状态提示 */}
      {isSuccess && (
        <p className="mt-3 text-center text-xs text-emerald-400">
          Transaction confirmed successfully!
        </p>
      )}
    </div>
  );
}
