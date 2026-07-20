// ==========================================
// 第一段：USDT 本位 View 查询工具函数库 (Read-Only)
// ==========================================
import { ethers } from 'ethers';

// 精度配置（请根据实际链修改：主网/TRON/以太坊 USDT 常用 6；BSC 链 USDT 常用 18）
const USDT_DECIMALS = 6;   
const TOKEN_DECIMALS = 18; 

/**
 * [View] 根据 Token 数量获取对应的 USDT 价值
 */
export async function getUsdtValueFromToken(tokenWei, routerContract, tokenAddress, usdtAddress) {
  if (!tokenWei || tokenWei.eq(0)) return "0.00";
  try {
    const path = [tokenAddress, usdtAddress];
    const amountsOut = await routerContract.getAmountsOut(tokenWei, path);
    return ethers.utils.formatUnits(amountsOut[1], USDT_DECIMALS);
  } catch (error) {
    console.error("查询 Token 转 USDT 价值失败:", error);
    return "0.00";
  }
}

/**
 * [View] 根据输入的 USDT 金额，计算所需的代币 Wei 数量
 */
export async function getTokenWeiFromUsdt(usdtAmount, routerContract, tokenAddress, usdtAddress) {
  if (!usdtAmount || Number(usdtAmount) <= 0) return ethers.BigNumber.from(0);
  const targetUsdtWei = ethers.utils.parseUnits(usdtAmount.toString(), USDT_DECIMALS);
  const path = [tokenAddress, usdtAddress];
  const amountsIn = await routerContract.getAmountsIn(targetUsdtWei, path);
  return amountsIn[0]; // 返回换算出的 Token 数量 (Wei)
}

/**
 * [View] 获取用户当前代币持仓（直接转换为 USDT 显示）
 */
export async function getUserBalanceInUsdt(userAddress, tokenContract, routerContract, usdtAddress) {
  try {
    const tokenBalanceWei = await tokenContract.balanceOf(userAddress);
    const usdtValue = await getUsdtValueFromToken(
      tokenBalanceWei, 
      routerContract, 
      tokenContract.address, 
      usdtAddress
    );
    return usdtValue; // 返回如 "125.50" (USDT)
  } catch (error) {
    console.error("获取用户持仓 USDT 失败:", error);
    return "0.00";
  }
}

/**
 * [View] 获取合约/池子的总锁仓量 TVL（直接转换为 USDT 显示）
 */
export async function getTvlInUsdt(vaultAddress, tokenContract, routerContract, usdtAddress) {
  try {
    const tvlTokenWei = await tokenContract.balanceOf(vaultAddress);
    const tvlUsdt = await getUsdtValueFromToken(
      tvlTokenWei, 
      routerContract, 
      tokenContract.address, 
      usdtAddress
    );
    return tvlUsdt; // 返回如 "500000.00" (USDT)
  } catch (error) {
    console.error("获取 TVL (USDT) 失败:", error);
    return "0.00";
  }
}
// ==========================================
// 第二段：看板 View 整合与 USDT 买卖核心逻辑
// ==========================================
import { ethers } from 'ethers';
import { 
  getUsdtValueFromToken, 
  getTokenWeiFromUsdt, 
  getUserBalanceInUsdt, 
  getTvlInUsdt 
} from './part1'; // 如果写在同一个文件请忽略此行 import

const USDT_DECIMALS = 6;

/**
 * 1. 一键加载页面所有 View 数据 (持仓 USDT、TVL USDT)
 */
export async function loadDashboardUsdtViews(userAddress, vaultAddress, contracts, usdtAddress) {
  const { tokenContract, routerContract } = contracts;

  // 并行获取用户持仓(USDT) 与 整体TVL(USDT)
  const [userHoldingsUsdt, tvlUsdt] = await Promise.all([
    getUserBalanceInUsdt(userAddress, tokenContract, routerContract, usdtAddress),
    getTvlInUsdt(vaultAddress, tokenContract, routerContract, usdtAddress)
  ]);

  return {
    userHoldingsUsdt, // 用户当前持仓对应的 USDT 价值
    tvlUsdt           // 项目总锁仓 TVL (USDT)
  };
}

/**
 * 2. 按 USDT 金额执行【卖出】
 */
export async function executeSellByUsdt(usdtAmount, contracts, usdtAddress, userAddress) {
  const { tokenContract, routerContract, sellContract } = contracts;

  try {
    // A. 将 USDT 金额换算为对应的代币 Wei 数量
    const requiredTokenWei = await getTokenWeiFromUsdt(
      usdtAmount, 
      routerContract, 
      tokenContract.address, 
      usdtAddress
    );

    // B. 校验代币余额
    const userBalanceWei = await tokenContract.balanceOf(userAddress);
    if (userBalanceWei.lt(requiredTokenWei)) {
      const currentHoldingsUsdt = await getUsdtValueFromToken(
        userBalanceWei, routerContract, tokenContract.address, usdtAddress
      );
      throw new Error(`持仓不足！你想卖出 $${usdtAmount} USDT，但当前持仓仅约 $${currentHoldingsUsdt} USDT。`);
    }

    // C. 检查并授权 (Approve)
    const allowance = await tokenContract.allowance(userAddress, sellContract.address);
    if (allowance.lt(requiredTokenWei)) {
      console.log("授权额度不足，发起 Approve...");
      const approveTx = await tokenContract.approve(sellContract.address, ethers.constants.MaxUint256);
      await approveTx.wait();
    }

    // D. 执行卖出合约调用
    console.log(`正在卖出价值 $${usdtAmount} USDT 的代币...`);
    const tx = await sellContract.sell(requiredTokenWei);
    const receipt = await tx.wait();

    console.log("✅ 卖出成功！Hash:", receipt.transactionHash);
    return { success: true, hash: receipt.transactionHash };

  } catch (error) {
    console.error("❌ 卖出失败:", error);
    const errorStr = JSON.stringify(error) + (error?.data || "");
    if (errorStr.includes("0xe450d38c")) {
      alert("【卖出失败】触发合约限制 (0xe450d38c)，可能是单笔卖出额度超限或池子流动性不足，请调小卖出 USDT 金额。");
    } else {
      alert(`【卖出失败】${error.reason || error.message || "交易被拒绝"}`);
    }
    return { success: false, error };
  }
}

/**
 * 3. 按 USDT 金额执行【买入】
 */
export async function executeBuyByUsdt(usdtAmount, contracts, usdtAddress, userAddress) {
  const { buyContract, usdtContract } = contracts;

  try {
    const usdtWei = ethers.utils.parseUnits(usdtAmount.toString(), USDT_DECIMALS);

    // A. 校验用户的 USDT 余额
    const userUsdtBalance = await usdtContract.balanceOf(userAddress);
    if (userUsdtBalance.lt(usdtWei)) {
      throw new Error(`USDT 余额不足！你当前只有 ${ethers.utils.formatUnits(userUsdtBalance, USDT_DECIMALS)} USDT。`);
    }

    // B. 检查 USDT 授权
    const allowance = await usdtContract.allowance(userAddress, buyContract.address);
    if (allowance.lt(usdtWei)) {
      console.log("USDT 授权额度不足，发起 Approve...");
      const approveTx = await usdtContract.approve(buyContract.address, ethers.constants.MaxUint256);
      await approveTx.wait();
    }

    // C. 调用买入合约
    console.log(`正在使用 $${usdtAmount} USDT 买入...`);
    const tx = await buyContract.buy(usdtWei);
    const receipt = await tx.wait();

    console.log("✅ 买入成功！Hash:", receipt.transactionHash);
    return { success: true, hash: receipt.transactionHash };

  } catch (error) {
    console.error("❌ 买入失败:", error);
    alert(`【买入失败】${error.reason || error.message || "交易被拒绝"}`);
    return { success: false, error };
  }
}
