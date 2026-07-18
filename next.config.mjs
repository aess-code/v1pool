/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 这些模块在初始化时直接调用 indexedDB / localStorage 等浏览器 API
      // 在 Node.js SSR/SSG 环境中会抛出 ReferenceError: indexedDB is not defined
      // 强制将它们标记为外部模块，只在客户端加载
      config.externals = config.externals || [];
      config.externals.push(
        '@walletconnect/ethereum-provider',
        '@walletconnect/universal-provider',
        '@walletconnect/logger',
        '@metamask/sdk',
        'pino-pretty',
        'encoding',
      );
    }
    return config;
  },
};
export default nextConfig;
