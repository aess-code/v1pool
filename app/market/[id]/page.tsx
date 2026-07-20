"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useReadContracts,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { useQueryClient } from "@tanstack/react-query";
import { MARKET_ABI, USDT_ABI, USDT_ADDRESS, YES, NO } from "../../../constants";
import { parseUnits, formatUnits, Address } from "viem";
import { toast } from "sonner";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Share2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  Clock,
  Trophy,
  AlertTriangle,
  X,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import Header from "../../../components/Header";

type TradeTab = "buy" | "sell";
type Side = "yes" | "no";

const STATUS_OPEN    = 0;
const STATUS_CLOSING = 1;
const STATUS_SETTLED = 2;

// TxProgressBar, ConfirmCloseModal, ClaimRewardModal 组件保持原样（此处省略，你直接复制粘贴到对应位置）
function TxProgressBar({ isPending, isConfirming }: { isPending: boolean; isConfirming: boolean }) {
  // ... 原代码不变 ...
}

function ConfirmCloseModal({ onConfirm, onCancel, isLoading }: { onConfirm: () => void; onCancel: () => void; isLoading: boolean; }) {
  // ... 原代码不变 ...
}

function ClaimRewardModal({ amount, yesWins, isTie, onClaim, onDismiss, isLoading, isSuccess, question }: {
  amount: string; yesWins: boolean; isTie: boolean; onClaim: () => void; onDismiss: () => void; isLoading: boolean; isSuccess: boolean; question?: string;
}) {
  // ... 原代码不变 ...
}

export default function MarketDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketAddress = params.id as Address;
  const { address: userAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const isWrongChain = isConnected && chainId !== sepolia.id;

  const queryClient = useQueryClient();

  const [showWelcomeBanner, setShowWelcomeBanner] = useState(() => searchParams.get("new") === "true");
  useEffect(() => {
    if (!showWelcomeBanner) return;
    const timer = setTimeout(() => setShowWelcomeBanner(false), 5000);
    return () => clearTimeout(timer);
  }, [showWelcomeBanner]);

  const [tab, setTab] = useState<TradeTab>("buy");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimModalDismissed, setClaimModalDismissed] = useState(false);
  const [claimJustSucceeded, setClaimJustSucceeded] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const isApprovingRef = useRef(isApproving);
  const isClaimingRef = useRef(isClaiming);
  useEffect(() => { isApprovingRef.current = isApproving; }, [isApproving]);
  useEffect(() => { isClaimingRef.current = isClaiming; }, [isClaiming]);

  // 读取市场数据（保持不变）
  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: marketAddress, abi: MARKET_ABI, functionName: "question" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "description" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getConfidence" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getTVL" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "status" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "createdAt" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "creator" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "timeUntilSettlement" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "settledYesWins" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "isTie" },
    ],
    query: { refetchInterval: 10000 },
  });

  const question = data?.[0]?.result as string | undefined;
  const description = data?.[1]?.result as string | undefined;
  const confidence = data?.[2]?.result as bigint | undefined;
  const tvl = data?.[3]?.result as bigint | undefined;
  const status = data?.[4]?.result as number | undefined;
  const createdAt = data?.[5]?.result as bigint | undefined;
  const creator = data?.[6]?.result as Address | undefined;
  const timeUntilSettle = data?.[7]?.result as bigint | undefined;
  const settledYesWins = data?.[8]?.result as boolean | undefined;
  const isTie = data?.[9]?.result as boolean | undefined;

  const confidencePercent = confidence !== undefined ? Number(confidence) / 100 : 50;
  const tvlFormatted = tvl !== undefined ? Number(tvl).toFixed(2) : "0.00";
  const daysLeft = timeUntilSettle !== undefined && timeUntilSettle > 0n ? Math.ceil(Number(timeUntilSettle) / 86400) : 0;

  const { data: userPosition } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "getUserPosition",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 10000 },
  });

  const [yesBal, noBal, yesValue, noValue] = (userPosition as [bigint, bigint, bigint, bigint]) || [0n, 0n, 0n, 0n];

  const { data: claimAmount } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "getClaimAmount",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && status === STATUS_SETTLED, refetchInterval: 10000 },
  });

  const { data: hasClaimed } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "claimed",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && status === STATUS_SETTLED },
  });

  const claimAmountFormatted = claimAmount ? (Number(claimAmount) / 1000000).toFixed(2) : "0.00";

  useEffect(() => {
    if (status === STATUS_SETTLED && isConnected && !hasClaimed && !claimModalDismissed && claimAmount && Number(claimAmount) > 0) {
      const timer = setTimeout(() => setShowClaimModal(true), 800);
      return () => clearTimeout(timer);
    }
  }, [status, isConnected, hasClaimed, claimModalDismissed, claimAmount]);

  const { data: usdtBalance } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 10000 },
  });

  const { data: allowance } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "allowance",
    args: userAddress ? [userAddress, marketAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 5000 },
  });

  const usdtBalanceFormatted = usdtBalance ? parseFloat(formatUnits(usdtBalance as bigint, 6)).toFixed(2) : "0.00";

  const amountBigInt = amount ? parseUnits(amount, 6) : 0n;
  const needsApproval = tab === "buy" && (allowance as bigint || 0n) < amountBigInt;

  const { writeContractAsync, isPending, data: txHash, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const isProcessing = isPending || isConfirming;

  // 统一费用计算（与合约一致）
  const calculateFees = (usdtAmount: number, isBuy: boolean, currentStatus: number) => {
    if (usdtAmount <= 0) return { fee: 0, net: 0 };
    const creatorFeeRate = currentStatus === STATUS_OPEN ? 0.005 : 0;
    const treasuryAFeeRate = 0.003;
    const treasuryBFeeRate = 0.002;
    const totalFeeRate = creatorFeeRate + treasuryAFeeRate + treasuryBFeeRate;
    const fee = usdtAmount * totalFeeRate;
    const net = usdtAmount - fee;
    return { fee: Number(fee.toFixed(6)), net: Number(net.toFixed(6)) };
  };

  useEffect(() => {
    if (!isConfirmed) return;
    const wasApproving = isApprovingRef.current;
    const wasClaiming = isClaimingRef.current;
    if (wasApproving) {
      toast.success("Approved! You can now buy.");
      setIsApproving(false);
    } else if (wasClaiming) {
      setClaimJustSucceeded(true);
      setIsClaiming(false);
      toast.success("Reward claimed!");
    } else {
      toast.success("Transaction confirmed!");
    }
    setAmount("");
    queryClient.invalidateQueries();
    setTimeout(() => reset(), 200);
  }, [isConfirmed]);

  const handleApprove = async () => {
    if (!amountBigInt) return;
    setIsApproving(true);
    try {
      await writeContractAsync({
        address: USDT_ADDRESS,
        abi: USDT_ABI,
        functionName: "approve",
        args: [marketAddress, amountBigInt * 2n],
      });
      toast.info("Waiting for approval...");
    } catch (err: any) {
      toast.error(err.shortMessage || err.message || "Approval failed");
      setIsApproving(false);
    }
  };

  const handleTrade = async () => {
    if (!amountBigInt || amountBigInt === 0n) {
      toast.error("Please enter an amount");
      return;
    }
    const sideValue = BigInt(side === "yes" ? YES : NO);
    try {
      if (tab === "buy") {
        await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "buy", args: [sideValue, amountBigInt] });
      } else {
        // Sell 需要 shares
        const currentBal = side === "yes" ? yesBal : noBal;
        const positionUSDT = Number(formatUnits(currentBal, 6));
        const inputUSDT = parseFloat(amount);
        if (positionUSDT === 0) {
          toast.error("No position to sell");
          return;
        }
        const sharesToSell = (currentBal * BigInt(Math.floor((inputUSDT / positionUSDT) * 1_000_000))) / BigInt(1_000_000);
        await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "sell", args: [sideValue, sharesToSell] });
      }
      toast.info(`${tab.toUpperCase()} order submitted...`);
    } catch (err: any) {
      toast.error(err.shortMessage || err.message || "Transaction failed");
    }
  };

  // 其他 handle 函数（handleRequestClose, handleSettle, handleClaim, handleShare）保持原样
  const handleRequestClose = async () => { /* 原代码 */ };
  const handleSettle = async () => { /* 原代码 */ };
  const handleClaim = async () => { /* 原代码 */ };
  const handleShare = () => { /* 原代码 */ };

  const isCreator = userAddress && creator && userAddress.toLowerCase() === creator.toLowerCase();

  if (isLoading) {
    return <div className="min-h-screen bg-zinc-950"><Header /><div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 text-zinc-600 animate-spin" /></div></div>;
  }

  // StatusBadge, SettlementBanner 等保持原样...

  return (
    <div className="min-h-screen bg-zinc-950">
      <TxProgressBar isPending={isPending} isConfirming={isConfirming} />
      <Header />

      {/* 弹窗保持原样 */}

      <main className="max-w-2xl mx-auto px-4 pb-24">
        {/* Back button, Welcome Banner, Market Info Card, My Position 等保持原样 */}

        {/* 交易区 */}
        {status !== STATUS_SETTLED && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            {/* Tab, Side 选择保持原样 */}

            <div className="mb-4">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-zinc-500">{tab === "buy" ? "Amount to buy (USDT)" : "Amount to sell (USDT)"}</label>
                {/* Balance 显示保持原样 */}
              </div>
              <div className="relative">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="..." />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600 font-medium">USDT</span>
              </div>
              {/* 快捷按钮保持原样 */}
            </div>

            {/* 修复后的预估显示 */}
            {amount && parseFloat(amount) > 0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 mb-4">
                <div className="space-y-1.5 text-xs">
                  {tab === "buy" ? (
                    (() => {
                      const { fee, net } = calculateFees(parseFloat(amount), true, status || 0);
                      return (
                        <>
                          <div className="flex justify-between"><span className="text-zinc-600">Input</span><span>{parseFloat(amount).toFixed(4)} USDT</span></div>
                          <div className="flex justify-between"><span className="text-zinc-600">Fee</span><span className="text-rose-400">-{fee} USDT</span></div>
                          <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-emerald-400 font-medium">You pay (net)</span><span className="text-emerald-400">{net} USDT</span></div>
                        </>
                      );
                    })()
                  ) : (
                    (() => {
                      const positionUSDT = Number(formatUnits(side === "yes" ? yesBal : noBal, 6));
                      const inputUSDT = parseFloat(amount);
                      const { fee, net } = calculateFees(inputUSDT, false, status || 0);
                      return (
                        <>
                          <div className="flex justify-between"><span className="text-zinc-600">Selling Value</span><span>{inputUSDT.toFixed(4)} USDT</span></div>
                          <div className="flex justify-between"><span className="text-zinc-600">Fee</span><span className="text-rose-400">-{fee} USDT</span></div>
                          <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-emerald-400 font-medium">You receive</span><span className="text-emerald-400">{net} USDT</span></div>
                        </>
                      );
                    })()
                  )}
                </div>
              </div>
            )}

            {/* 按钮区域保持原样，但 handleTrade 已修复 */}
            {/* ... */}

          </div>
        )}
      </main>
    </div>
  );
}