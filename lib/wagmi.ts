import { createConfig, http } from "wagmi";
import { sepolia, mainnet } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  "81f17a311f51265fd1024a28609f582c";

// ✅ 同时注册 sepolia 和 mainnet，sepolia 排第一（默认链）
// 不依赖 NEXT_PUBLIC_ENABLE_TESTNETS 环境变量开关
export const config = createConfig({
  chains: [sepolia, mainnet],
  // EIP-6963 自动发现：OKX、MetaMask、Coinbase、Trust、Rainbow、Bitget、Rabby 等
  multiInjectedProviderDiscovery: true,
  connectors: [
    // 1. 通用兜底：window.ethereum（imToken/TokenPocket 旧版等）
    injected(),

    // 2. OKX 内置浏览器专用（window.okxwallet）
    injected({
      target() {
        return {
          id: "okxwallet",
          name: "OKX Wallet",
          provider:
            typeof window !== "undefined"
              ? (window as any).okxwallet
              : undefined,
        };
      },
    }),

    // 3. Bitget 内置浏览器专用（window.bitkeep.ethereum）
    injected({
      target() {
        return {
          id: "bitkeep",
          name: "Bitget Wallet",
          provider:
            typeof window !== "undefined"
              ? (window as any).bitkeep?.ethereum
              : undefined,
        };
      },
    }),

    // 4. TokenPocket 内置浏览器专用
    injected({
      target() {
        return {
          id: "tokenpocket",
          name: "TokenPocket",
          provider:
            typeof window !== "undefined"
              ? (window as any).tokenpocket
              : undefined,
        };
      },
    }),

    // 5. imToken 内置浏览器专用
    injected({
      target() {
        return {
          id: "imtoken",
          name: "imToken",
          provider:
            typeof window !== "undefined"
              ? (window as any).imToken ||
                ((window as any).ethereum?.isImToken
                  ? (window as any).ethereum
                  : undefined)
              : undefined,
        };
      },
    }),

    // 6. WalletConnect：扫码连接，覆盖所有移动端钱包
    walletConnect({
      projectId: walletConnectProjectId,
      showQrModal: true,
    }),
  ],
  transports: {
    [sepolia.id]: http(
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com"
    ),
    [mainnet.id]: http(
      process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
        "https://ethereum-rpc.publicnode.com"
    ),
  },
  // ssr: true 已移除 —— WalletConnect 在 SSR 初始化时调用 indexedDB 导致崩溃
});
