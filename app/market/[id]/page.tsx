// ==========================================
// 第一段：USDT 视角查询工具 (兼容 Ethers v5/v6)
// ==========================================
import { ethers } from 'ethers';

// 兼容处理：自动识别 Ethers v5 和 v6 的解析函数
const parseUnits = (val, dec) => 
  ethers.utils ? ethers.utils.parseUnits(val.toString(), dec) : ethers.parseUnits(val.toString(), dec);

const formatUnits = (val, dec) => 
  ethers.utils ? ethers.utils.formatUnits(val, dec) : ethers.formatUnits(val, dec);

/**
 * [View] 查询任意 Token 数量对应的 USDT 价值
 */
export async function getUsdtValueFromToken(tokenWei, routerContract, tokenAddress, usdtAddress, usdtDecimals = 6) {
  if (!tokenWei || tokenWei.toString() === '0') return "0.00";
  try {
    const path = [tokenAddress, usdtAddress];
    const amountsOut = await routerContract.getAmountsOut(tokenWei, path);
    return formatUnits(amountsOut[1], usdtDecimals);
  } catch (error) {
    console.error("查询 USDT 价值失败:", error);
    return "0.00";
  }
}

/**
 * [View] 输入 USDT 数值，反算需要的代币 Wei 数量
 */
export async function getTokenWeiFromUsdt(usdtAmount, routerContract, tokenAddress, usdtAddress, usdtDecimals = 6) {
  if (!usdtAmount || Number(usdtAmount) <= 0) return 0;
  const targetUsdtWei = parseUnits(usdtAmount, usdtDecimals);
  const path = [tokenAddress, usdtAddress];
  const amountsIn = await routerContract.getAmountsIn(targetUsdtWei, path);
  return amountsIn[0]; // 返回需要的 Token Wei
}

/**
 * [View] 获取用户当前持仓折算的 USDT 价值
 */
export async function getUserBalanceInUsdt(userAddress, tokenContract, routerContract, usdtAddress, usdtDecimals = 6) {
  try {
    const tokenBalanceWei = await tokenContract.balanceOf(userAddress);
    return await getUsdtValueFromToken(tokenBalanceWei, routerContract, tokenContract.address, usdtAddress, usdtDecimals);
  } catch (error) {
    console.error("获取持仓 USDT 失败:", error);
    return "0.00";
  }
}

/**
 * [View] 获取池子/合约总锁仓量 TVL (以 USDT 显示)
 */
export async function getTvlInUsdt(vaultAddress, tokenContract, routerContract, usdtAddress, usdtDecimals = 6) {
  try {
    const tvlTokenWei = await tokenContract.balanceOf(vaultAddress);
    return await getUsdtValueFromToken(tvlTokenWei, routerContract, tokenContract.address, usdtAddress, usdtDecimals);
  } catch (error) {
    console.error("获取 TVL 失败:", error);
    return "0.00";
  }
}
// ==========================================
// 第二段：USDT 本位买卖交易 (独立无依赖，兼容 v5/v6)
// ==========================================
import { ethers } from 'ethers';

// 兼容处理助手
const parseUnits = (val, dec) => 
  ethers.utils ? ethers.utils.parseUnits(val.toString(), dec) : ethers.parseUnits(val.toString(), dec);

const getMaxUint256 = () => 
  ethers.constants ? ethers.constants.MaxUint256 : ethers.MaxUint256;

/**
 * 按 USDT 金额【卖出】
 */
export async function executeSellByUsdt(usdtAmount, contracts, usdtAddress, userAddress, usdtDecimals = 6) {
  const { tokenContract, routerContract, sellContract } = contracts;

  try {
    // 1. USDT 金额转代币 Wei 数量
    const targetUsdtWei = parseUnits(usdtAmount, usdtDecimals);
    const amountsIn = await routerContract.getAmountsIn(targetUsdtWei, [tokenContract.address, usdtAddress]);
    const requiredTokenWei = amountsIn[0];

    // 2. 校验代币余额
    const userBalance = await tokenContract.balanceOf(userAddress);
    if (BigInt(userBalance.toString()) < BigInt(requiredTokenWei.toString())) {
      throw new Error(`持仓不足！无法兑换 $${usdtAmount} USDT。`);
    }

    // 3. 校验并授权代币
    const allowance = await tokenContract.allowance(userAddress, sellContract.address);
    if (BigInt(allowance.toString()) < BigInt(requiredTokenWei.toString())) {
      console.log("正在发起代币授权 Approve...");
      const approveTx = await tokenContract.approve(sellContract.address, getMaxUint256());
      await approveTx.wait();
    }

    // 4. 发起 sell 交易
    console.log(`正在卖出价值 $${usdtAmount} USDT 的代币...`);
    const tx = await sellContract.sell(requiredTokenWei);
    const receipt = await tx.wait();

    return { success: true, hash: receipt.transactionHash || receipt.hash };

  } catch (error) {
    console.error("卖出执行异常:", error);

    // 统一转字符串，捕获 0xe450d38c 自定义错误
    const errorMsg = (error?.data || "") + (error?.message || "") + JSON.stringify(error);

    if (errorMsg.includes("0xe450d38c")) {
      alert("【卖出失败】触发合约限制 (0xe450d38c)。\n可能原因：卖出金额超过了单笔限额，或池子流动性不足。\n建议：调小 USDT 卖出数量后再试。");
    } else {
      alert(`【卖出失败】${error.reason || error.message || "交易取消或失败"}`);
    }
    return { success: false, error };
  }
}

/**
 * 按 USDT 金额【买入】
 */
export async function executeBuyByUsdt(usdtAmount, contracts, userAddress, usdtDecimals = 6) {
  const { buyContract, usdtContract } = contracts;

  try {
    const usdtWei = parseUnits(usdtAmount, usdtDecimals);

    // 1. 检查 USDT 余额
    const userUsdt = await usdtContract.balanceOf(userAddress);
    if (BigInt(userUsdt.toString()) < BigInt(usdtWei.toString())) {
      throw new Error("钱包内的 USDT 余额不足！");
    }

    // 2. 检查并授权 USDT
    const allowance = await usdtContract.allowance(userAddress, buyContract.address);
    if (BigInt(allowance.toString()) < BigInt(usdtWei.toString())) {
      console.log("正在发起 USDT 授权 Approve...");
      const approveTx = await usdtContract.approve(buyContract.address, getMaxUint256());
      await approveTx.wait();
    }

    // 3. 发起 buy 交易
    console.log(`正在买入 $${usdtAmount} USDT...`);
    const tx = await buyContract.buy(usdtWei);
    const receipt = await tx.wait();

    return { success: true, hash: receipt.transactionHash || receipt.hash };

  } catch (error) {
    console.error("买入执行异常:", error);
    alert(`【买入失败】${error.reason || error.message || "交易取消或失败"}`);
    return { success: false, error };
  }
}
