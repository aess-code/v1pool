const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TradingEngine — Round 2 Full Test Suite", function () {
    let TradingEngine;
    let tradingEngine;
    let mockFactory, mockVault, mockPriceEngine, mockFeeManager, mockToken;
    let owner, user, user2;

    const VIEW_ID = 1;
    const SIDE_FOR = 0;
    const SIDE_AGAINST = 1;

    // Standard mock outputs
    const SHARES_OUT   = ethers.parseEther("50");
    const NEW_INDEX    = 5100n;
    const NET_AMOUNT   = ethers.parseEther("99"); // 100 - 1% fee
    const NEW_RESERVE  = NET_AMOUNT;
    const AMOUNT_OUT   = ethers.parseEther("40");
    const NEW_INDEX_S  = 4900n;
    const NEW_RESERVE_S = ethers.parseEther("59"); // reserve after sell

    async function deployAll() {
        [owner, user, user2] = await ethers.getSigners();

        const MockToken       = await ethers.getContractFactory("MockERC20");
        const MockFactory     = await ethers.getContractFactory("MockPulseFactory");
        const MockVault       = await ethers.getContractFactory("MockMarketVault");
        const MockPriceEngine = await ethers.getContractFactory("MockPriceEngine");
        const MockFeeManager  = await ethers.getContractFactory("MockFeeManager");

        mockToken       = await MockToken.deploy();
        mockFactory     = await MockFactory.deploy();
        mockVault       = await MockVault.deploy();
        mockPriceEngine = await MockPriceEngine.deploy();
        mockFeeManager  = await MockFeeManager.deploy();

        await Promise.all([
            mockToken.waitForDeployment(),
            mockFactory.waitForDeployment(),
            mockVault.waitForDeployment(),
            mockPriceEngine.waitForDeployment(),
            mockFeeManager.waitForDeployment(),
        ]);

        await mockVault.setToken(await mockToken.getAddress());
        await mockFactory.setExists(VIEW_ID, true);
        await mockFactory.setVault(VIEW_ID, await mockVault.getAddress());
        await mockFactory.setView(VIEW_ID, {
            viewId: VIEW_ID, creator: owner.address, viewType: 0,
            metadataURI: "", metadataHash: ethers.ZeroHash,
            createdAt: Math.floor(Date.now() / 1000),
            startTime: Math.floor(Date.now() / 1000),
            endTime: Math.floor(Date.now() / 1000) + 3600,
            vault: await mockVault.getAddress(),
            priceEngine: await mockPriceEngine.getAddress(),
            settlementManager: ethers.ZeroAddress,
            feeConfig: { totalBps: 100, creatorBps: 5000, treasuryBps: 3000, teamBps: 2000 }
        });

        TradingEngine = await ethers.getContractFactory("TradingEngine");
        tradingEngine = await TradingEngine.deploy(
            await mockFactory.getAddress(),
            await mockPriceEngine.getAddress(),
            await mockFeeManager.getAddress()
        );
        await tradingEngine.waitForDeployment();

        await mockToken.mint(user.address, ethers.parseEther("10000"));
        // User approves TradingEngine to pull tokens (TradingEngine calls safeTransferFrom user → vault)
        await mockToken.connect(user).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
        await mockToken.connect(user2).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
    }

    beforeEach(deployAll);

    // ─────────────────────────────────────────────────────────────────────────
    // buy() — Success Path
    // ─────────────────────────────────────────────────────────────────────────
    describe("buy() — Success Path", function () {
        beforeEach(async () => {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NEW_RESERVE);
        });

        it("Should update forSupply, reserve, pulseIndex after buy FOR", async function () {
            const amountIn = ethers.parseEther("100");
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.forSupply).to.equal(SHARES_OUT);
            expect(state.reserveBalance).to.equal(NEW_RESERVE);
            expect(state.lastPulseIndex).to.equal(NEW_INDEX);
        });

        it("Should update user position after buy", async function () {
            const amountIn = ethers.parseEther("100");
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            const pos = await tradingEngine.getPosition(VIEW_ID, user.address);
            expect(pos.forShares).to.equal(SHARES_OUT);
        });

        it("Should transfer gross amount to Vault (Fix ①: fee asset flow)", async function () {
            const amountIn = ethers.parseEther("100");
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            expect(await mockVault.lastDepositAmount()).to.equal(amountIn);
        });

        it("Should record 1% fee in FeeManager (Fix ①: fee accounting)", async function () {
            const amountIn = ethers.parseEther("100");
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            const expectedFee = amountIn / 100n;
            expect(await mockFeeManager.lastRecordedFee()).to.equal(expectedFee);
        });

        it("Should emit Bought with correct parameters (Fix ⑪)", async function () {
            const amountIn = ethers.parseEther("100");
            const tx = await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            await expect(tx).to.emit(tradingEngine, "Bought")
                .withArgs(VIEW_ID, user.address, SIDE_FOR, amountIn, SHARES_OUT, NEW_INDEX);
        });

        it("Should emit PulseIndexUpdated with final storage value (Fix ⑪)", async function () {
            const amountIn = ethers.parseEther("100");
            const tx = await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            await expect(tx).to.emit(tradingEngine, "PulseIndexUpdated")
                .withArgs(VIEW_ID, NEW_INDEX);
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.lastPulseIndex).to.equal(NEW_INDEX);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // buy() — Failure & Rollback Tests (Fix ①)
    // ─────────────────────────────────────────────────────────────────────────
    describe("buy() — ERC20 Failure Rollback (Fix ①)", function () {
        beforeEach(async () => {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NEW_RESERVE);
        });

        it("Should revert if amountIn is zero", async function () {
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, 0))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__ZeroAmount");
        });

        it("Should revert if side is invalid", async function () {
            await expect(tradingEngine.connect(user).buy(VIEW_ID, 2, 100))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidSide");
        });

        it("Should revert and rollback all state if transferFrom fails (insufficient allowance)", async function () {
            await mockToken.connect(user).approve(await tradingEngine.getAddress(), 0);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.reverted;
            // Verify complete rollback
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.forSupply).to.equal(0);
            expect(state.reserveBalance).to.equal(0);
            const pos = await tradingEngine.getPosition(VIEW_ID, user.address);
            expect(pos.forShares).to.equal(0);
        });

        it("Should revert and rollback all state if transferFrom fails (insufficient balance)", async function () {
            const poorUser = user2;
            await mockToken.connect(poorUser).approve(await mockVault.getAddress(), ethers.MaxUint256);
            // poorUser has 0 balance
            await expect(tradingEngine.connect(poorUser).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.reverted;
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.forSupply).to.equal(0);
        });

        it("Should revert and rollback all state if Vault.deposit fails", async function () {
            await mockVault.setDepositFail(true);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.reverted;
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.forSupply).to.equal(0);
            expect(state.reserveBalance).to.equal(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // sell() — Success Path
    // ─────────────────────────────────────────────────────────────────────────
    describe("sell() — Success Path", function () {
        beforeEach(async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NEW_RESERVE);
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100"));
            await mockPriceEngine.setQuoteSell(AMOUNT_OUT, NEW_INDEX_S, NEW_RESERVE_S);
        });

        it("Should deduct forShares from user position after sell", async function () {
            const sharesIn = ethers.parseEther("20");
            await tradingEngine.connect(user).sell(VIEW_ID, SIDE_FOR, sharesIn);
            const pos = await tradingEngine.getPosition(VIEW_ID, user.address);
            expect(pos.forShares).to.equal(SHARES_OUT - sharesIn);
        });

        it("Should update forSupply and reserve after sell", async function () {
            const sharesIn = ethers.parseEther("20");
            await tradingEngine.connect(user).sell(VIEW_ID, SIDE_FOR, sharesIn);
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.forSupply).to.equal(SHARES_OUT - sharesIn);
            expect(state.reserveBalance).to.equal(NEW_RESERVE_S);
        });

        it("Should emit Sold with correct parameters (Fix ⑪)", async function () {
            const sharesIn = ethers.parseEther("20");
            const tx = await tradingEngine.connect(user).sell(VIEW_ID, SIDE_FOR, sharesIn);
            await expect(tx).to.emit(tradingEngine, "Sold")
                .withArgs(VIEW_ID, user.address, SIDE_FOR, sharesIn, AMOUNT_OUT, NEW_INDEX_S);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // sell() — Vault Liquidity Failure Rollback (Fix ②)
    // ─────────────────────────────────────────────────────────────────────────
    describe("sell() — Vault Liquidity Failure Rollback (Fix ②)", function () {
        beforeEach(async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NEW_RESERVE);
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100"));
            await mockPriceEngine.setQuoteSell(AMOUNT_OUT, NEW_INDEX_S, NEW_RESERVE_S);
        });

        it("Should revert if user has insufficient position", async function () {
            await expect(tradingEngine.connect(user).sell(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InsufficientPosition");
        });

        it("Should revert and rollback all state if Vault.withdraw fails", async function () {
            await mockVault.setWithdrawFail(true);
            const sharesIn = ethers.parseEther("20");
            const stateBefore = await tradingEngine.getMarketState(VIEW_ID);
            const posBefore = await tradingEngine.getPosition(VIEW_ID, user.address);

            await expect(tradingEngine.connect(user).sell(VIEW_ID, SIDE_FOR, sharesIn))
                .to.be.reverted;

            // Verify complete rollback
            const stateAfter = await tradingEngine.getMarketState(VIEW_ID);
            const posAfter = await tradingEngine.getPosition(VIEW_ID, user.address);
            expect(stateAfter.forSupply).to.equal(stateBefore.forSupply);
            expect(stateAfter.reserveBalance).to.equal(stateBefore.reserveBalance);
            expect(posAfter.forShares).to.equal(posBefore.forShares);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Defensive Validation Tests (Fix ③④⑤)
    // ─────────────────────────────────────────────────────────────────────────
    describe("Defensive Validation — PriceEngine Output (Fix ③④⑤)", function () {
        it("Should revert if PriceEngine returns sharesOut = 0", async function () {
            await mockPriceEngine.setQuoteBuy(0, 5100, NET_AMOUNT);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidPriceEngineOutput");
        });

        it("Should revert if PriceEngine returns newPulseIndex = 0 (Fix ④)", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 0, NET_AMOUNT);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidPriceEngineOutput");
        });

        it("Should revert if PriceEngine returns newPulseIndex = 10000 (Fix ④)", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 10000, NET_AMOUNT);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidPriceEngineOutput");
        });

        it("Should revert if PriceEngine returns newReserveBalance = 0 on buy", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 5100, 0);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidReserveBalance");
        });

        it("Should revert if PriceEngine returns reserve decreasing on buy (Fix ⑤)", async function () {
            // Reserve decreasing on buy is invalid (solvency violation)
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 5100, 1n); // 1 wei < initial 0 is fine, but < current reserve is invalid
            // Set initial reserve to something > 1
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 5100, NET_AMOUNT);
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100"));
            // Now try a second buy where reserve would decrease
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 5100, 1n);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidReserveBalance");
        });

        it("Should revert if sell amountOut = 0", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NEW_RESERVE);
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100"));
            await mockPriceEngine.setQuoteSell(0, NEW_INDEX_S, NEW_RESERVE_S);
            await expect(tradingEngine.connect(user).sell(VIEW_ID, SIDE_FOR, ethers.parseEther("10")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidPriceEngineOutput");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Fee-Vault Consistency (Fix ⑧)
    // ─────────────────────────────────────────────────────────────────────────
    describe("Fee-Vault Consistency (Fix ⑧)", function () {
        it("VaultBalance should equal reserve + cumulative fees after buy", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NET_AMOUNT);
            const amountIn = ethers.parseEther("100");
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);

            const vaultBalance = await mockVault.balance();
            const reserve = (await tradingEngine.getMarketState(VIEW_ID)).reserveBalance;
            const totalFees = await mockFeeManager.totalRecordedFees();

            // Vault balance = reserve (net) + fees (1%)
            expect(vaultBalance).to.equal(reserve + totalFees);
        });

        it("FeeManager recorded fee should match 1% of amountIn", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, NEW_INDEX, NET_AMOUNT);
            const amountIn = ethers.parseEther("100");
            await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
            expect(await mockFeeManager.lastRecordedFee()).to.equal(amountIn / 100n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Math Stress Test — Sequential Buy/Sell (Fix ⑨)
    // ─────────────────────────────────────────────────────────────────────────
    describe("Math Stress Test — Sequential Buy/Sell (Fix ⑨)", function () {
        it("Should maintain consistent state after 10 sequential buy/sell cycles", async function () {
            let currentReserve = 0n;
            let currentSupply = 0n;
            const amountIn = ethers.parseEther("10");
            const sharesPerTrade = ethers.parseEther("9");
            const netAmount = amountIn - amountIn / 100n;

            for (let i = 0; i < 10; i++) {
                const newReserve = currentReserve + netAmount;
                await mockPriceEngine.setQuoteBuy(sharesPerTrade, 5100, newReserve);
                await tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, amountIn);
                currentReserve = newReserve;
                currentSupply += sharesPerTrade;
            }

            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.forSupply).to.equal(currentSupply);
            expect(state.reserveBalance).to.equal(currentReserve);

            const pos = await tradingEngine.getPosition(VIEW_ID, user.address);
            expect(pos.forShares).to.equal(currentSupply);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Extreme Trade Tests (Fix ⑩)
    // ─────────────────────────────────────────────────────────────────────────
    describe("Extreme Trade Tests (Fix ⑩)", function () {
        it("Should handle minimum amount (1 wei) buy without overflow", async function () {
            // 1 wei: fee = 0 (rounds down), netAmount = 1
            await mockPriceEngine.setQuoteBuy(1n, 5001n, 1n);
            await mockToken.mint(user.address, 1n);
            await mockToken.connect(user).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, 1n))
                .to.not.be.reverted;
        });

        it("Should handle large amount buy without overflow", async function () {
            const largeAmount = ethers.parseEther("1000000");
            const largeNet = largeAmount - largeAmount / 100n;
            await mockToken.mint(user.address, largeAmount);
            await mockToken.connect(user).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
            await mockPriceEngine.setQuoteBuy(largeNet, 9999n, largeNet);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, largeAmount))
                .to.not.be.reverted;
            const state = await tradingEngine.getMarketState(VIEW_ID);
            expect(state.lastPulseIndex).to.equal(9999n);
        });

        it("Should revert buy if PulseIndex would be 10000 (boundary)", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 10000n, NET_AMOUNT);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.be.revertedWithCustomError(tradingEngine, "TradingEngine__InvalidPriceEngineOutput");
        });

        it("Should revert buy if PulseIndex would be 1 (boundary is valid)", async function () {
            await mockPriceEngine.setQuoteBuy(SHARES_OUT, 1n, NET_AMOUNT);
            await mockToken.connect(user).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
            await expect(tradingEngine.connect(user).buy(VIEW_ID, SIDE_FOR, ethers.parseEther("100")))
                .to.not.be.reverted;
        });
    });
});
