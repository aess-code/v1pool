"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { decodeEventLog, type Address } from "viem";
import { FACTORY_ADDRESS, FACTORY_ABI } from "@/constants";
import { toast } from "sonner";
import { Loader2, X, AlertTriangle } from "lucide-react";

// ── 从 receipt.logs 中解析 MarketCreated 事件，返回新市场地址 ────────────────
function parseNewMarketAddress(
  logs: readonly { topics: readonly `0x${string}`[]; data: `0x${string}`; address: Address }[]
): Address | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: FACTORY_ABI,
        eventName: "MarketCreated",
        topics: log.topics as any,
        data: log.data,
      });
      // decoded.args.market 是新市场的合约地址（indexed 参数在 topics 中）
      return (decoded.args as { market: Address }).market;
    } catch {
      // 跳过非目标事件的 log
    }
  }
  return null;
}

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 交易成功后的回调，用于触发父组件的静默数据刷新 */
  onSuccess?: () => void;
}

export default function CreateModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateModalProps) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // ── 交易成功：解析新市场地址 → 跳转 ─────────────────────────────────────────
  useEffect(() => {
    if (!isConfirmed || !receipt) return;

    const newMarketAddress = parseNewMarketAddress(receipt.logs);

    // 重置表单状态
    setQuestion("");
    setDescription("");

    // 通知父组件做静默数据刷新（invalidateQueries），不阻塞跳转
    onSuccess?.();

    if (newMarketAddress) {
      // 关闭弹窗后立即跳转到新市场详情页，携带 ?new=true 触发欢迎横幅
      onClose();
      router.push(`/market/${newMarketAddress}?new=true`);
    } else {
      // 极少数情况下解析失败（如 RPC 返回不完整），降级为 toast 提示
      toast.success("市场创建成功！");
      onClose();
    }
  }, [isConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ receipt/onSuccess/onClose/router 均为稳定引用，不放入依赖以防闭包陷阱

  // ── 写合约报错时显示 toast ─────────────────────────────────────────────────
  useEffect(() => {
    if (!writeError) return;
    const msg = writeError.message ?? "";
    if (msg.includes("User rejected") || msg.includes("user rejected")) {
      toast.error("已取消：你在钱包中拒绝了签名");
    } else if (msg.includes("insufficient funds")) {
      toast.error("余额不足：请确保有足够的 ETH 支付 Gas");
    } else {
      toast.error(`交易失败：${msg.slice(0, 80)}`);
    }
  }, [writeError]);

  if (!isOpen) return null;

  const isProcessing = isPending || isConfirming || isSwitchingChain;
  const questionLength = question.length;
  const isValid = questionLength > 5 && questionLength <= 300;
  const isWrongChain = isConnected && chainId !== sepolia.id;
  const isContractMissing =
    !FACTORY_ADDRESS ||
    FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !isConnected || isProcessing) return;
    if (isContractMissing) {
      toast.error("合约地址未配置，请联系管理员");
      return;
    }
    if (isWrongChain) {
      toast.error("请先切换到 Sepolia 测试网");
      return;
    }
    resetWrite();
    writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "createMarket",
      args: [question, description],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !isProcessing && onClose()}
      />

      <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">创建新市场</h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-xl text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── 错误链提示横幅 ── */}
        {isWrongChain && (
          <div className="mb-4 flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-amber-300 font-medium">
                当前不在 Sepolia 测试网
              </p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                合约部署在 Sepolia，需要切换后才能创建市场
              </p>
            </div>
            <button
              onClick={() => switchChain({ chainId: sepolia.id })}
              disabled={isSwitchingChain}
              className="flex-shrink-0 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {isSwitchingChain ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "切换"
              )}
            </button>
          </div>
        )}

        {/* ── 合约未配置提示 ── */}
        {isContractMissing && (
          <div className="mb-4 flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3.5 py-3">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300">
              合约地址未配置，请在 Vercel 环境变量中设置{" "}
              <code className="font-mono">NEXT_PUBLIC_FACTORY_ADDRESS</code>
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 问题输入 */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              观点问题 *
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例如：以太坊会在 2025 年突破 $5000 吗？"
              rows={3}
              maxLength={300}
              disabled={isProcessing}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 text-sm text-white outline-none focus:border-zinc-600 resize-none placeholder:text-zinc-600 transition-colors"
            />
            <div className="flex justify-between items-center mt-1 text-xs">
              <span
                className={
                  isValid
                    ? "text-emerald-400"
                    : questionLength > 0
                    ? "text-amber-400"
                    : "text-transparent"
                }
              >
                {isValid ? "问题有效 ✓" : questionLength > 0 ? "至少 6 个字符" : "."}
              </span>
              <span className="text-zinc-600">{questionLength}/300</span>
            </div>
          </div>

          {/* 背景说明 */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              背景说明{" "}
              <span className="text-zinc-600 font-normal">(可选)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充背景信息，帮助参与者理解问题..."
              rows={2}
              disabled={isProcessing}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 text-sm text-white outline-none focus:border-zinc-600 resize-none placeholder:text-zinc-600 transition-colors"
            />
          </div>

          {/* 0.5% 手续费激励提示 */}
          <div className="flex items-start gap-2.5 bg-indigo-500/8 border border-indigo-500/20 rounded-xl px-3.5 py-3">
            <span className="text-indigo-400 text-base leading-none mt-0.5">💰</span>
            <p className="text-xs text-indigo-300/80 leading-relaxed">
              市场创建后，每笔买卖将向参与者收取{" "}
              <span className="text-indigo-300 font-semibold">0.5% 手续费</span>
              ，直接打入你的钱包。
            </p>
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={
              !isValid ||
              isProcessing ||
              !isConnected ||
              isWrongChain ||
              isContractMissing
            }
            className="w-full bg-white text-black py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isSwitchingChain
                  ? "切换网络中..."
                  : isPending
                  ? "请在钱包中确认..."
                  : "链上打包中..."}
              </>
            ) : !isConnected ? (
              "请先连接钱包"
            ) : isWrongChain ? (
              "请切换到 Sepolia 网络"
            ) : (
              "创建市场"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
