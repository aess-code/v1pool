"use client";

import React, { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { Connector } from "wagmi";
import { X, Loader2, ExternalLink, QrCode } from "lucide-react";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// 钱包图标：优先使用 EIP-6963 提供的图标，否则用内置 SVG
const WALLET_ICONS: Record<string, string> = {
  metaMask: "🦊",
  okxwallet: "⭕",
  bitkeep: "💎",
  tokenpocket: "🔵",
  imtoken: "🔷",
  coinbaseWalletSDK: "🔵",
  walletConnect: "🔗",
  injected: "💼",
};

const WALLET_DESCRIPTIONS: Record<string, string> = {
  metaMask: "最流行的以太坊钱包",
  okxwallet: "OKX 交易所钱包",
  bitkeep: "Bitget 旗下 Web3 钱包",
  tokenpocket: "多链去中心化钱包",
  imtoken: "老牌以太坊钱包",
  coinbaseWalletSDK: "Coinbase 官方钱包",
  walletConnect: "扫码连接任意钱包",
  injected: "浏览器注入钱包",
};

function WalletOption({
  connector,
  onClick,
}: {
  connector: Connector;
  onClick: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const provider = await connector.getProvider();
        if (mounted) {
          setReady(!!provider);
          setChecking(false);
        }
      } catch {
        if (mounted) {
          setReady(false);
          setChecking(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [connector]);

  // 跳过：未检测到 provider 且不是 WalletConnect 的连接器
  const isWalletConnect = connector.id === "walletConnect";
  if (!checking && !ready && !isWalletConnect) return null;

  const icon = WALLET_ICONS[connector.id] || "💼";
  const desc = WALLET_DESCRIPTIONS[connector.id] || "Web3 钱包";

  return (
    <button
      onClick={onClick}
      disabled={checking}
      className={[
        "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left",
        "hover:bg-slate-800/80 active:scale-[0.98]",
        checking ? "opacity-50" : "opacity-100",
      ].join(" ")}
    >
      {/* 图标区域 */}
      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xl flex-shrink-0 overflow-hidden">
        {/* 优先使用 EIP-6963 提供的图标 */}
        {(connector as any).icon ? (
          <img
            src={(connector as any).icon}
            alt={connector.name}
            className="w-7 h-7 rounded-lg object-contain"
          />
        ) : (
          <span>{icon}</span>
        )}
      </div>

      {/* 文字区域 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-100 truncate">
            {connector.name}
          </span>
          {isWalletConnect && (
            <QrCode className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">{desc}</p>
      </div>

      {/* 状态指示 */}
      {checking ? (
        <Loader2 className="w-4 h-4 text-slate-600 animate-spin flex-shrink-0" />
      ) : ready ? (
        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
      ) : (
        <ExternalLink className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
      )}
    </button>
  );
}

export default function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors, isPending } = useConnect();

  // 去重：EIP-6963 可能会和手动配置的连接器重复
  // 优先保留 EIP-6963 发现的（带 icon 和 rdns），去掉手动配置的同名连接器
  const deduped = React.useMemo(() => {
    const seen = new Set<string>();
    const result: Connector[] = [];

    // 先处理 EIP-6963 发现的（有 rdns 属性）
    for (const c of connectors) {
      if ((c as any).rdns) {
        const key = (c as any).rdns;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(c);
        }
      }
    }

    // 再处理手动配置的（没有 rdns）
    for (const c of connectors) {
      if (!(c as any).rdns) {
        // 用 id 去重，避免重复展示同一个钱包
        const key = c.id;
        // 跳过已经通过 EIP-6963 发现的同类钱包
        const alreadyCovered =
          (key === "okxwallet" && seen.has("com.okex.wallet")) ||
          (key === "bitkeep" && seen.has("com.bitget.web3")) ||
          (key === "tokenpocket" && seen.has("pro.tokenpocket")) ||
          (key === "imtoken" && seen.has("im.token.app")) ||
          (key === "metaMask" && seen.has("io.metamask")) ||
          (key === "injected" && result.length > 1); // 有其他钱包时隐藏通用 injected

        if (!alreadyCovered && !seen.has(key)) {
          seen.add(key);
          result.push(c);
        }
      }
    }

    return result;
  }, [connectors]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗主体 */}
      <div className="relative w-full sm:max-w-sm bg-slate-950 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* 顶部把手（移动端） */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">连接钱包</h2>
            <p className="text-xs text-slate-500 mt-0.5">选择你的 Web3 钱包</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* 钱包列表 */}
        <div className="px-3 pb-6 space-y-0.5 max-h-[60vh] overflow-y-auto">
          {isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
              <span className="ml-2 text-sm text-slate-400">连接中...</span>
            </div>
          ) : (
            deduped.map((connector) => (
              <WalletOption
                key={connector.uid}
                connector={connector}
                onClick={() => {
                  connect({ connector });
                  onClose();
                }}
              />
            ))
          )}
        </div>

        {/* 底部说明 */}
        <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-900/40">
          <p className="text-xs text-slate-600 text-center">
            连接即表示你已阅读并同意平台使用条款。你的资产由你的钱包自主保管。
          </p>
        </div>
      </div>
    </div>
  );
}
