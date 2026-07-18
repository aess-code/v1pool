"use client";

import React, { useState, useCallback } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { FACTORY_ADDRESS, FACTORY_ABI, MARKET_ABI } from "@/constants";
import { type Address } from "viem";
import Header from "@/components/Header";
import MarketCard, { MarketData } from "@/components/MarketCard";
import CreateModal from "@/components/CreateMarketModal";
import { Search, Plus, Loader2, Flame, Clock, Timer } from "lucide-react";

const MARKET_FETCH_LIMIT = 50n;
const STATUS_CLOSING = 1;

export default function HomePage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"newest" | "hot" | "closing">("newest");

  // TanStack Query 客户端，用于交易成功后的静默后台刷新
  const queryClient = useQueryClient();

  const { data: marketCount, isLoading: isCountLoading } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getMarketCount",
    query: { refetchInterval: 15_000 },
  });

  const { data: marketAddresses, isLoading: isMarketsLoading } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getMarkets",
    args: [0n, MARKET_FETCH_LIMIT],
    query: {
      enabled: marketCount !== undefined && (marketCount as bigint) > 0n,
      refetchInterval: 15_000,
    },
  });

  const addresses = (marketAddresses as Address[] | undefined) ?? [];

  // 一次性批量读取所有市场的所有必要数据，避免 N+1 查询
  const { data: marketsRawData, isLoading: isDataLoading } = useReadContracts({
    contracts: addresses.flatMap((addr) => [
      { address: addr, abi: MARKET_ABI, functionName: "question" as const },
      { address: addr, abi: MARKET_ABI, functionName: "getConfidence" as const },
      { address: addr, abi: MARKET_ABI, functionName: "getTVL" as const },
      { address: addr, abi: MARKET_ABI, functionName: "status" as const },
      { address: addr, abi: MARKET_ABI, functionName: "createdAt" as const },
      { address: addr, abi: MARKET_ABI, functionName: "timeUntilSettlement" as const },
      { address: addr, abi: MARKET_ABI, functionName: "totalVolume" as const },
      { address: addr, abi: MARKET_ABI, functionName: "participantCount" as const },
    ]),
    query: {
      enabled: addresses.length > 0,
      refetchInterval: 15_000,
    },
  });

  const isLoading = isCountLoading || isMarketsLoading || (addresses.length > 0 && isDataLoading);

  // 组装结构化数据
  const allMarkets = addresses.map((addr, i) => {
    const baseIdx = i * 8;
    const question = (marketsRawData?.[baseIdx]?.result as string) || "";
    const confidence = (marketsRawData?.[baseIdx + 1]?.result as bigint) || 5000n;
    const tvl = (marketsRawData?.[baseIdx + 2]?.result as bigint) || 0n;
    const status = (marketsRawData?.[baseIdx + 3]?.result as number) ?? 0;
    const createdAt = (marketsRawData?.[baseIdx + 4]?.result as bigint) || 0n;
    const timeUntilSettle = (marketsRawData?.[baseIdx + 5]?.result as bigint) || 0n;
    const totalVolume = (marketsRawData?.[baseIdx + 6]?.result as bigint) || 0n;
    const participantCount = (marketsRawData?.[baseIdx + 7]?.result as bigint) || 0n;

    return {
      address: addr,
      question,
      confidencePercent: Number(confidence) / 100,
      tvlFormatted: (Number(tvl) / 1_000_000).toFixed(2),
      status,
      createdAt: Number(createdAt),
      daysLeft: timeUntilSettle > 0n ? Math.ceil(Number(timeUntilSettle) / 86400) : 0,
      
      // 用于排序的原始数据
      _timeUntilSettle: Number(timeUntilSettle),
      _totalVolume: Number(totalVolume),
      _tvl: Number(tvl),
      _participantCount: Number(participantCount),
    };
  });

  // 按问题文本进行搜索过滤
  const searchFilteredMarkets = searchQuery
    ? allMarkets.filter((m) => m.question.toLowerCase().includes(searchQuery.toLowerCase()))
    : allMarkets;

  // 根据 Tab 计算最终展示的市场列表
  let displayMarkets = [...searchFilteredMarkets];
  
  if (activeTab === "newest") {
    displayMarkets.reverse();
  } else if (activeTab === "hot") {
    displayMarkets.forEach(m => {
      const participantWeight = m._participantCount * 100_000_000;
      (m as any)._score = (m._totalVolume * 0.5) + (m._tvl * 0.3) + (participantWeight * 0.2);
    });
    displayMarkets.sort((a: any, b: any) => b._score - a._score);
  } else if (activeTab === "closing") {
    displayMarkets = displayMarkets
      .filter((m) => m.status === STATUS_CLOSING)
      .sort((a, b) => a._timeUntilSettle - b._timeUntilSettle);
  }

  // 创建成功回调：只做静默刷新，跳转逻辑由 CreateModal 内部处理
  const handleCreateSuccess = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 pb-20">
      <Header />

      {/* 移动端钱包提示横幅 */}
      <div className="md:hidden bg-indigo-500/10 border-b border-indigo-500/20 px-4 py-3 flex items-start gap-3">
        <span className="text-xl">💡</span>
        <p className="text-sm text-indigo-200">
          建议在{" "}
          <span className="font-semibold text-indigo-400">OKX 钱包</span> 或
          MetaMask 内置浏览器打开本站，体验最佳
        </p>
      </div>

      <main className="max-w-3xl mx-auto px-4 pt-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 tracking-tight">Macket</h1>
          <p className="text-zinc-400">用钱表达你的观点</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-10">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="搜索市场..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3.5 pl-12 pr-4 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-colors active:scale-[0.98] shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-5 h-5" />
            <span>创建市场</span>
          </button>
        </div>

        <div className="space-y-6">
          {/* 排序 Tab */}
          <div className="flex items-center gap-6 border-b border-zinc-800/80 pb-3">
            <button
              onClick={() => setActiveTab("newest")}
              className={`flex items-center gap-2 font-medium transition-colors ${
                activeTab === "newest"
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Clock className="w-4 h-4" />
              最新市场
            </button>
            <button
              onClick={() => setActiveTab("hot")}
              className={`flex items-center gap-2 font-medium transition-colors ${
                activeTab === "hot"
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Flame className="w-4 h-4" />
              最热市场
            </button>
            <button
              onClick={() => setActiveTab("closing")}
              className={`flex items-center gap-2 font-medium transition-colors ${
                activeTab === "closing"
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Timer className="w-4 h-4" />
              即将结算
            </button>
          </div>

          {/* 市场列表 */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p>加载市场数据中...</p>
            </div>
          ) : displayMarkets.length === 0 ? (
            <div className="text-center py-20 text-zinc-500 bg-zinc-900/30 rounded-3xl border border-zinc-800/50 border-dashed">
              {activeTab === "closing" ? (
                <p className="text-lg">暂无即将结算的市场</p>
              ) : (
                <>
                  <p className="mb-4 text-lg">还没有任何市场</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    成为第一个创建者 →
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {displayMarkets.map((market) => (
                <MarketCard key={market.address} market={market} />
              ))}
            </div>
          )}
        </div>
      </main>

      <CreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
