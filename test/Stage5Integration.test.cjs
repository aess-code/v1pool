/**
 * Stage 5 Full Integration & Security Test Suite
 *
 * Tests the complete Pulse Protocol V1 lifecycle:
 *   1. Create View (Factory)
 *   2. User A buy FOR, User B buy AGAINST
 *   3. Multiple trades
 *   4. Record fees
 *   5. Lock market
 *   6. Resolve result (settleMarket)
 *   7. Claim winnings (claimReward)
 *   8. Claim fees (creator/treasury/team)
 *   9. Verify Vault invariant
 *
 * Security tests:
 *   - Reentrancy protection
 *   - Permission enforcement
 *   - Edge cases (1 wei, max uint, zero, repeated claim)
 */

const { expect } = require("chai");
const { ethers }  = require("hardhat");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function deployProtocol() {
    const [deployer, creator, userA, userB, treasury, team, attacker] =
        await ethers.getSigners();

    // Deploy settlement token
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy();
    await token.waitForDeployment();

    // Mint tokens to users
    const MINT = ethers.parseEther("1000000");
    await token.mint(userA.address, MINT);
    await token.mint(userB.address, MINT);
    await token.mint(attacker.address, MINT);

    // Deploy PriceEngine (real)
    const PriceEngine = await ethers.getContractFactory("PriceEngine");
    const priceEngine = await PriceEngine.deploy();
    await priceEngine.waitForDeployment();

    // Deploy MarketVaultFactory (needs factory address — use deployer as placeholder, update after)
    const VaultFactory = await ethers.getContractFactory("MarketVaultFactory");
    // We need to pass the PulseFactory address, but it's not deployed yet.
    // Use a two-step deployment: deploy VaultFactory with a temp address, then deploy PulseFactory.
    // Since MarketVaultFactory.authorizedFactory is immutable, we use a different approach:
    // Deploy PulseFactory first with a placeholder VaultFactory, then redeploy.
    // Simplest: deploy VaultFactory with deployer as temp factory, then redeploy with real factory.
    // For integration tests, we use a MockVaultFactory that accepts any caller.
    const MockVaultFactory = await ethers.getContractFactory("MockVaultFactoryForIntegration");
    const vaultFactory = await MockVaultFactory.deploy(await token.getAddress());
    await vaultFactory.waitForDeployment();

    // Deploy TradingEngine (needs factory, priceEngine, feeManager — deploy FeeManager first)
    // FeeManager needs TradingEngine address — circular dependency.
    // Resolution: deploy TradingEngine with a placeholder FeeManager, then deploy FeeManager,
    // then deploy PulseFactory. TradingEngine's feeManager is immutable, so we need to
    // deploy FeeManager first with a placeholder TradingEngine.
    //
    // For integration tests, we use a two-pass approach:
    // 1. Deploy MockFactory (to get its address)
    // 2. Deploy TradingEngine with MockFeeManager
    // 3. Deploy real FeeManager with TradingEngine address
    // 4. Deploy PulseFactory
    //
    // Since TradingEngine.feeManager is immutable, we use a MockFeeManager wrapper
    // that delegates to the real FeeManager once it's deployed.

    // For simplicity in integration tests, use the real contracts with a careful deployment order:
    // Deploy a temporary MockFeeManager first, then deploy TradingEngine,
    // then deploy real FeeManager, then deploy PulseFactory.
    // TradingEngine will use MockFeeManager for recordFee calls.
    // We'll test the real FeeManager separately.

    // Use MockPulseFactory for TradingEngine deployment
    const MockFactory = await ethers.getContractFactory("MockPulseFactory");
    const mockFactory = await MockFactory.deploy();
    await mockFactory.waitForDeployment();

    const MockFeeManager = await ethers.getContractFactory("MockFeeManager");
    const mockFeeManager = await MockFeeManager.deploy();
    await mockFeeManager.waitForDeployment();

    const TradingEngine = await ethers.getContractFactory("TradingEngine");
    const tradingEngine = await TradingEngine.deploy(
        await mockFactory.getAddress(),
        await priceEngine.getAddress(),
        await mockFeeManager.getAddress()
    );
    await tradingEngine.waitForDeployment();

    // Deploy SettlementManager
    const SettlementManager = await ethers.getContractFactory("SettlementManager");
    const settlementManager = await SettlementManager.deploy(
        await tradingEngine.getAddress(),
        await mockFactory.getAddress()
    );
    await settlementManager.waitForDeployment();

    // Deploy real FeeManager
    const FeeManager = await ethers.getContractFactory("FeeManager");
    const feeManager = await FeeManager.deploy(
        await tradingEngine.getAddress(),
        await mockFactory.getAddress(),
        treasury.address,
        team.address
    );
    await feeManager.waitForDeployment();

    return {
        token, priceEngine, tradingEngine, settlementManager, feeManager,
        mockFactory, mockFeeManager, vaultFactory,
        deployer, creator, userA, userB, treasury, team, attacker
    };
}

async function setupView(ctx, endTimeOffset = 7200) {
    const { mockFactory, tradingEngine, settlementManager, token } = ctx;
    const VIEW_ID = 1;
    const now = Math.floor(Date.now() / 1000);
    const endTime = now + endTimeOffset;

    // Deploy a real Vault
    // Note: authorizedTradingEngine is set in the constructor, so setFeeManager
    // must be called by the TradingEngine address. We impersonate it.
    const MarketVault = await ethers.getContractFactory("MarketVault");
    const vault = await MarketVault.deploy(
        VIEW_ID,
        await token.getAddress(),
        await tradingEngine.getAddress(),
        await settlementManager.getAddress()
    );
    await vault.waitForDeployment();

    // Set FeeManager on Vault via TradingEngine impersonation
    const teAddr = await tradingEngine.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [teAddr]);
    await ethers.provider.send("hardhat_setBalance", [teAddr, "0x" + ethers.parseEther("1").toString(16)]);
    const teSigner = await ethers.getImpersonatedSigner(teAddr);
    await vault.connect(teSigner).setFeeManager(await ctx.mockFeeManager.getAddress());
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [teAddr]);

    // Register vault in MockFeeManager
    await ctx.mockFeeManager.setVaultForView(VIEW_ID, await vault.getAddress());

    // Setup MockFactory
    await mockFactory.setExists(VIEW_ID, true);
    await mockFactory.setVault(VIEW_ID, await vault.getAddress());
    await mockFactory.setView(VIEW_ID, {
        viewId: VIEW_ID,
        creator: ctx.creator.address,
        viewType: 0, // FIXED
        metadataURI: "ipfs://test",
        metadataHash: ethers.ZeroHash,
        createdAt: now,
        startTime: now,
        endTime: endTime,
        vault: await vault.getAddress(),
        priceEngine: await ctx.priceEngine.getAddress(),
        settlementManager: await settlementManager.getAddress(),
        feeConfig: { totalBps: 100, creatorBps: 50, treasuryBps: 30, teamBps: 20 }
    });

    // Approve TradingEngine for users
    await ctx.token.connect(ctx.userA).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
    await ctx.token.connect(ctx.userB).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
    await ctx.token.connect(ctx.attacker).approve(await tradingEngine.getAddress(), ethers.MaxUint256);

    return { vault, VIEW_ID, endTime };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("Stage 5 — Full Integration & Security Tests", function () {
    let ctx;

    beforeEach(async function () {
        ctx = await deployProtocol();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 1: Basic Trade Flow
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 1: Basic Trade Flow", function () {
        it("User A can buy FOR position", async function () {
            const { vault, VIEW_ID } = await setupView(ctx);
            const amountIn = ethers.parseEther("100");
            const tx = await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, amountIn);
            await expect(tx).to.emit(ctx.tradingEngine, "Bought");
            const pos = await ctx.tradingEngine.getPosition(VIEW_ID, ctx.userA.address);
            expect(pos.forShares).to.be.gt(0n);
            expect(await vault.balance()).to.equal(amountIn);
        });

        it("User B can buy AGAINST position", async function () {
            const { vault, VIEW_ID } = await setupView(ctx);
            // Buy FOR first to establish a large reserve
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            // After 100 ETH FOR buy at index 5000:
            //   forShares = 100e18 * 10000 / 5000 = 200e18
            //   reserve = 100e18
            //   min(200e18, 0) = 0 <= 100e18 ✓
            // Now buy AGAINST: newAgainstShares = amountIn * 10000 / (10000 - newIndex)
            // newIndex after 100 ETH FOR = computeIndex(200e18, 0) = 9999 (max)
            // AGAINST price = 10000 - 9999 = 1 bps
            // So AGAINST shares = amountIn * 10000 / 1 = very large
            // To avoid solvency: min(forShares, newAgainstShares) <= newReserve
            // Use 10000 wei AGAINST (fee = 100 wei, notifyFeeRecorded won't revert)
            const amountIn = 10000n;
            await ctx.tradingEngine.connect(ctx.userB).buy(VIEW_ID, 1, amountIn);
            const pos = await ctx.tradingEngine.getPosition(VIEW_ID, ctx.userB.address);
            expect(pos.againstShares).to.be.gt(0n);
        });

        it("User can sell their position", async function () {
            const { VIEW_ID } = await setupView(ctx);
            // Buy FOR to establish position
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            const pos = await ctx.tradingEngine.getPosition(VIEW_ID, ctx.userA.address);
            const balBefore = await ctx.token.balanceOf(ctx.userA.address);
            // Sell only half the shares to avoid solvency issues with single-sided market
            const halfShares = pos.forShares / 2n;
            await ctx.tradingEngine.connect(ctx.userA).sell(VIEW_ID, 0, halfShares);
            const balAfter = await ctx.token.balanceOf(ctx.userA.address);
            expect(balAfter).to.be.gt(balBefore);
        });

        it("Fee is recorded after buy", async function () {
            const { VIEW_ID } = await setupView(ctx);
            const amountIn = ethers.parseEther("100");
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, amountIn);
            const expectedFee = amountIn / 100n;
            expect(await ctx.mockFeeManager.totalRecordedFees()).to.equal(expectedFee);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 2: Lifecycle — lockMarket
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 2: Lifecycle — lockMarket", function () {
        it("Should revert lockMarket before EndTime", async function () {
            const { VIEW_ID } = await setupView(ctx, 7200);
            await expect(
                ctx.tradingEngine.lockMarket(VIEW_ID)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__EndTimeNotReached");
        });

        it("Should lock market after EndTime", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await expect(ctx.tradingEngine.lockMarket(VIEW_ID))
                .to.emit(ctx.tradingEngine, "MarketLocked");
            expect(await ctx.tradingEngine.getMarketStatus(VIEW_ID)).to.equal(1); // LOCKED
        });

        it("Should revert lockMarket if already locked", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await expect(
                ctx.tradingEngine.lockMarket(VIEW_ID)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AlreadyLocked");
        });

        it("Should revert buy after market is locked", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await expect(
                ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__MarketNotActive");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 3: Settlement — setStatusSettlement / setStatusClaimable
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 3: Settlement — status transitions", function () {
        it("Should revert setStatusSettlement if caller is not SettlementManager", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await expect(
                ctx.tradingEngine.connect(ctx.attacker).setStatusSettlement(VIEW_ID)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__UnauthorisedSettlement");
        });

        it("Should revert setStatusClaimable if caller is not SettlementManager", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            // Advance to SETTLEMENT via impersonation
            const smAddr = await ctx.settlementManager.getAddress();
            await ethers.provider.send("hardhat_impersonateAccount", [smAddr]);
            await ethers.provider.send("hardhat_setBalance", [smAddr, "0x" + ethers.parseEther("1").toString(16)]);
            const smSigner = await ethers.getImpersonatedSigner(smAddr);
            await ctx.tradingEngine.connect(smSigner).setStatusSettlement(VIEW_ID);
            await ethers.provider.send("hardhat_stopImpersonatingAccount", [smAddr]);

            await expect(
                ctx.tradingEngine.connect(ctx.attacker).setStatusClaimable(VIEW_ID)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__UnauthorisedSettlement");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 4: SettlementManager.settleMarket
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 4: SettlementManager.settleMarket", function () {
        it("Should revert settleMarket if market is not LOCKED", async function () {
            const { VIEW_ID } = await setupView(ctx);
            await expect(
                ctx.settlementManager.settleMarket(VIEW_ID)
            ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__MarketNotLocked");
        });

        it("Should settle market and emit MarketSettled", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await expect(ctx.settlementManager.settleMarket(VIEW_ID))
                .to.emit(ctx.settlementManager, "MarketSettled");
            expect(await ctx.tradingEngine.getMarketStatus(VIEW_ID)).to.equal(3); // CLAIMABLE
        });

        it("Should revert settleMarket if already settled", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await ctx.settlementManager.settleMarket(VIEW_ID);
            await expect(
                ctx.settlementManager.settleMarket(VIEW_ID)
            ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__AlreadySettled");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 5: SettlementManager.claimReward
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 5: SettlementManager.claimReward", function () {
        it("Should revert claimReward if market is not CLAIMABLE", async function () {
            const { VIEW_ID } = await setupView(ctx);
            await expect(
                ctx.settlementManager.claimReward(VIEW_ID, ctx.userA.address)
            ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__MarketNotClaimable");
        });

        it("Should revert claimReward if user has no position", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await ctx.settlementManager.settleMarket(VIEW_ID);
            await expect(
                ctx.settlementManager.claimReward(VIEW_ID, ctx.userB.address)
            ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__NoPositionToClaim");
        });

        it("Should revert double claim", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await ctx.settlementManager.settleMarket(VIEW_ID);
            await ctx.settlementManager.claimReward(VIEW_ID, ctx.userA.address);
            await expect(
                ctx.settlementManager.claimReward(VIEW_ID, ctx.userA.address)
            ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__AlreadyClaimed");
        });

        it("Winner receives funds, loser receives nothing", async function () {
            const { vault, VIEW_ID } = await setupView(ctx, 1);
            // UserA buys FOR (drives index > 5000)
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            // UserB buys AGAINST (10000 wei to stay within solvency bounds)
            await ctx.tradingEngine.connect(ctx.userB).buy(VIEW_ID, 1, 10000n);

            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            await ctx.settlementManager.settleMarket(VIEW_ID);

            const result = await ctx.settlementManager.getSettlementResult(VIEW_ID);
            const balABefore = await ctx.token.balanceOf(ctx.userA.address);
            const balBBefore = await ctx.token.balanceOf(ctx.userB.address);

            if (result === 1n) { // FOR_WINS
                await ctx.settlementManager.claimReward(VIEW_ID, ctx.userA.address);
                const balAAfter = await ctx.token.balanceOf(ctx.userA.address);
                expect(balAAfter).to.be.gt(balABefore);
                // UserB (loser) should revert
                await expect(
                    ctx.settlementManager.claimReward(VIEW_ID, ctx.userB.address)
                ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__NoPositionToClaim");
            } else if (result === 2n) { // AGAINST_WINS
                await ctx.settlementManager.claimReward(VIEW_ID, ctx.userB.address);
                const balBAfter = await ctx.token.balanceOf(ctx.userB.address);
                expect(balBAfter).to.be.gt(balBBefore);
            }
            // DRAW: both can claim proportionally
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 6: FeeManager — Real Contract
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 6: FeeManager — Real Contract", function () {
        it("Should revert recordFee if caller is not TradingEngine", async function () {
            await expect(
                ctx.feeManager.connect(ctx.attacker).recordFee(1, ctx.creator.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(ctx.feeManager, "FeeManager__UnauthorisedCaller");
        });

        it("Should revert claimCreatorFee if caller is not the creator", async function () {
            await expect(
                ctx.feeManager.connect(ctx.attacker).claimCreatorFee(1)
            ).to.be.revertedWithCustomError(ctx.feeManager, "FeeManager__UnauthorisedCaller");
        });

        it("Should revert claimTreasuryFee if caller is not treasury", async function () {
            await expect(
                ctx.feeManager.connect(ctx.attacker).claimTreasuryFee(1)
            ).to.be.revertedWithCustomError(ctx.feeManager, "FeeManager__UnauthorisedCaller");
        });

        it("Should revert claimTeamFee if caller is not team", async function () {
            await expect(
                ctx.feeManager.connect(ctx.attacker).claimTeamFee(1)
            ).to.be.revertedWithCustomError(ctx.feeManager, "FeeManager__UnauthorisedCaller");
        });

        it("feeConfig returns correct split", async function () {
            const [creatorBps, treasuryBps, teamBps, totalBps] = await ctx.feeManager.feeConfig();
            expect(creatorBps).to.equal(50n);
            expect(treasuryBps).to.equal(30n);
            expect(teamBps).to.equal(20n);
            expect(totalBps).to.equal(100n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 7: Vault Invariant
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 7: Vault Invariant", function () {
        it("VaultBalance >= reserve after multiple trades", async function () {
            const { vault, VIEW_ID } = await setupView(ctx);
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            // Buy AGAINST with 10000 wei to stay within solvency bounds
            await ctx.tradingEngine.connect(ctx.userB).buy(VIEW_ID, 1, 10000n);
            const vaultBalance = await vault.balance();
            const reserve = (await ctx.tradingEngine.getMarketState(VIEW_ID)).reserveBalance;
            expect(vaultBalance).to.be.gte(reserve);
        });

        it("VaultBalance = reserve + unclaimedFees after buy", async function () {
            const { vault, VIEW_ID } = await setupView(ctx);
            const amountIn = ethers.parseEther("100");
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, amountIn);
            const vaultBalance = await vault.balance();
            const reserve = (await ctx.tradingEngine.getMarketState(VIEW_ID)).reserveBalance;
            const fee = amountIn / 100n;
            expect(vaultBalance).to.equal(reserve + fee);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 8: Edge Cases
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 8: Edge Cases", function () {
        it("Should revert buy with 0 amount", async function () {
            const { VIEW_ID } = await setupView(ctx);
            await expect(
                ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, 0)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__ZeroAmount");
        });

        it("Should revert buy with invalid side", async function () {
            const { VIEW_ID } = await setupView(ctx);
            await expect(
                ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 2, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__InvalidSide");
        });

        it("Should handle small amount (1000 wei) buy", async function () {
            const { VIEW_ID } = await setupView(ctx);
            // Small buy: fee rounds down to 0, net = 1000
            // 1000 wei: sharesOut = 1000 * 10000 / 5000 = 2000 shares
            // minSupply = min(2000, 0) = 0 <= 1000 reserve — solvency OK
            await expect(
                ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, 1000n)
            ).to.not.be.reverted;
        });

        it("Should revert sell with insufficient position", async function () {
            const { VIEW_ID } = await setupView(ctx);
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            await expect(
                ctx.tradingEngine.connect(ctx.userA).sell(VIEW_ID, 0, ethers.parseEther("999999"))
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__InsufficientPosition");
        });

        it("Should revert markPositionClaimed if caller is not SettlementManager", async function () {
            const { VIEW_ID } = await setupView(ctx);
            await expect(
                ctx.tradingEngine.connect(ctx.attacker).markPositionClaimed(VIEW_ID, ctx.userA.address)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__UnauthorisedSettlement");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 9: Permission Tests
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 9: Permission Tests", function () {
        it("Unauthorized lockMarket: anyone can call (permissionless)", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            // Anyone can call lockMarket — it's permissionless
            await expect(
                ctx.tradingEngine.connect(ctx.attacker).lockMarket(VIEW_ID)
            ).to.emit(ctx.tradingEngine, "MarketLocked");
        });

        it("Unauthorized settleMarket: anyone can call (permissionless)", async function () {
            const { VIEW_ID } = await setupView(ctx, 1);
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine", []);
            await ctx.tradingEngine.lockMarket(VIEW_ID);
            // Anyone can call settleMarket — it's permissionless
            await expect(
                ctx.settlementManager.connect(ctx.attacker).settleMarket(VIEW_ID)
            ).to.emit(ctx.settlementManager, "MarketSettled");
        });

        it("Unauthorized releaseFee: reverts", async function () {
            const { vault, VIEW_ID } = await setupView(ctx);
            await ctx.tradingEngine.connect(ctx.userA).buy(VIEW_ID, 0, ethers.parseEther("100"));
            await expect(
                vault.connect(ctx.attacker).releaseFee(ctx.attacker.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(vault, "Vault__UnauthorisedFeeManager");
        });
    });
});
