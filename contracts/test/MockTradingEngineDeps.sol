// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Controllable mock ERC20 for testing failure scenarios.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    bool public transferFromShouldFail;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function setTransferFromFail(bool fail) external {
        transferFromShouldFail = fail;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (transferFromShouldFail) revert("MockERC20: transferFrom failed");
        require(allowance[from][msg.sender] >= amount, "MockERC20: insufficient allowance");
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPulseFactory {
    struct FeeConfig { uint256 totalBps; uint256 creatorBps; uint256 treasuryBps; uint256 teamBps; }
    enum ViewType { FIXED, PERMANENT }
    struct ViewRecord {
        uint256 viewId; address creator; ViewType viewType; string metadataURI;
        bytes32 metadataHash; uint256 createdAt; uint256 startTime; uint256 endTime;
        address vault; address priceEngine; address settlementManager; FeeConfig feeConfig;
    }

    mapping(uint256 => bool) private _exists;
    mapping(uint256 => address) private _vaults;
    mapping(uint256 => ViewRecord) private _views;

    function setExists(uint256 viewId, bool val) external { _exists[viewId] = val; }
    function setVault(uint256 viewId, address vault) external { _vaults[viewId] = vault; }
    function setView(uint256 viewId, ViewRecord memory r) external { _views[viewId] = r; }

    function exists(uint256 viewId) external view returns (bool) { return _exists[viewId]; }
    function getVault(uint256 viewId) external view returns (address) { return _vaults[viewId]; }
    function getView(uint256 viewId) external view returns (ViewRecord memory) { return _views[viewId]; }
}

/// @notice Full-featured mock Vault supporting the complete IMarketVault interface
/// including releaseFee and setFeeManager for integration testing.
contract MockMarketVault {
    address public token;
    uint256 public lastDepositAmount;
    address public lastWithdrawTo;
    uint256 public lastWithdrawAmount;
    bool public depositShouldFail;
    bool public withdrawShouldFail;
    uint256 private _balance;

    // FeeManager authorization (mirrors MarketVault.sol design)
    address public authorizedFeeManager;
    address public authorizedTradingEngine;
    uint256 public totalFeesReleased;
    uint256 public totalFeesRecorded;
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint256 public totalSettled;

    // viewId for events
    uint256 public viewId;

    event FeeReleased(uint256 indexed viewId, address indexed recipient, uint256 amount);

    error Vault__UnauthorisedEngine();
    error Vault__UnauthorisedFeeManager();
    error Vault__FeeManagerNotSet();
    error Vault__FeeManagerAlreadySet();
    error Vault__ZeroAddress();
    error Vault__ZeroAmount();
    error Vault__InsufficientBalance();
    error Vault__InvalidRecipient();
    error Vault__FeeExceedsRecorded(uint256 requested, uint256 available);

    function setToken(address _token) external { token = _token; }
    function setAuthorizedTradingEngine(address te) external { authorizedTradingEngine = te; }
    function setViewId(uint256 _viewId) external { viewId = _viewId; }
    function setDepositFail(bool fail) external { depositShouldFail = fail; }
    function setWithdrawFail(bool fail) external { withdrawShouldFail = fail; }
    function setBalance(uint256 bal) external { _balance = bal; }

    function deposit(uint256 amount) external {
        if (depositShouldFail) revert("MockVault: deposit failed");
        lastDepositAmount = amount;
        totalDeposits += amount;
        _balance += amount;
    }

    function withdraw(address to, uint256 amount) external {
        if (withdrawShouldFail) revert("MockVault: withdraw failed");
        if (amount > _balance) revert Vault__InsufficientBalance();
        lastWithdrawTo = to;
        lastWithdrawAmount = amount;
        totalWithdrawals += amount;
        _balance -= amount;
        // Simulate actual ERC20 transfer
        MockERC20(token).transfer(to, amount);
    }

    function settle(address to, uint256 amount) external {
        if (amount > _balance) revert Vault__InsufficientBalance();
        totalSettled += amount;
        _balance -= amount;
        MockERC20(token).transfer(to, amount);
    }

    /// @notice One-time initialization of FeeManager address.
    /// Called by the authorized TradingEngine (proxy for Factory in tests).
    function setFeeManager(address feeManager) external {
        if (authorizedTradingEngine != address(0) && msg.sender != authorizedTradingEngine)
            revert Vault__UnauthorisedEngine();
        if (authorizedFeeManager != address(0)) revert Vault__FeeManagerAlreadySet();
        if (feeManager == address(0)) revert Vault__ZeroAddress();
        authorizedFeeManager = feeManager;
    }

    /// @notice Notify the Vault of a newly recorded fee obligation. Only callable by authorizedFeeManager.
    function notifyFeeRecorded(uint256 amount) external {
        if (authorizedFeeManager == address(0)) revert Vault__FeeManagerNotSet();
        if (msg.sender != authorizedFeeManager) revert Vault__UnauthorisedFeeManager();
        if (amount == 0) revert Vault__ZeroAmount();
        totalFeesRecorded += amount;
    }

    /// @notice Release fee collateral to a recipient. Only callable by authorizedFeeManager.
    function releaseFee(address recipient, uint256 amount) external {
        if (authorizedFeeManager == address(0)) revert Vault__FeeManagerNotSet();
        if (msg.sender != authorizedFeeManager) revert Vault__UnauthorisedFeeManager();
        if (recipient == address(0)) revert Vault__InvalidRecipient();
        if (amount == 0) revert Vault__ZeroAmount();
        if (amount > _balance) revert Vault__InsufficientBalance();
        // Independent fee quota check
        uint256 available = totalFeesRecorded - totalFeesReleased;
        if (amount > available) revert Vault__FeeExceedsRecorded(amount, available);
        totalFeesReleased += amount;
        _balance -= amount;
        MockERC20(token).transfer(recipient, amount);
        emit FeeReleased(viewId, recipient, amount);
    }

    function balance() external view returns (uint256) { return _balance; }
}

/// @notice Controllable mock PriceEngine for testing invalid output scenarios.
contract MockPriceEngine {
    uint256 private _sharesOut;
    uint256 private _amountOut;
    uint256 private _newIndex;
    uint256 private _newReserve;

    function setQuoteBuy(uint256 s, uint256 i, uint256 r) external {
        _sharesOut = s; _newIndex = i; _newReserve = r;
    }

    function setQuoteSell(uint256 a, uint256 i, uint256 r) external {
        _amountOut = a; _newIndex = i; _newReserve = r;
    }

    function quoteBuy(uint256, uint256, uint256, uint256, uint256) external view returns (uint256, uint256, uint256) {
        return (_sharesOut, _newIndex, _newReserve);
    }

    function quoteSell(uint256, uint256, uint256, uint256, uint256) external view returns (uint256, uint256, uint256) {
        return (_amountOut, _newIndex, _newReserve);
    }
}

/// @notice Mock FeeManager that records calls and supports releaseFee via Vault.
/// This mock simulates the CORRECT architecture: FeeManager holds only accounting,
/// and calls Vault.releaseFee() when a claim is made.
contract MockFeeManager {
    uint256 public lastRecordedFee;
    uint256 public totalRecordedFees;

    // Per-view fee ledger (creator, treasury, team)
    mapping(uint256 => uint256) public pendingCreatorFees;
    mapping(uint256 => uint256) public pendingTreasuryFees;
    mapping(uint256 => uint256) public pendingTeamFees;

    // Fee split constants (matching IFeeManager)
    uint256 public constant CREATOR_BPS  = 50; // 50% of total fee
    uint256 public constant TREASURY_BPS = 30; // 30% of total fee
    uint256 public constant TEAM_BPS     = 20; // 20% of total fee
    uint256 public constant TOTAL_BPS    = 100; // 100% = 1% of trade

    // Per-view vault registry (set by test setup)
    mapping(uint256 => address) public vaultForView;

    function setVaultForView(uint256 viewId, address vault) external {
        vaultForView[viewId] = vault;
    }

    function recordFee(uint256 viewId, address creator, uint256 amount) external {
        lastRecordedFee = amount;
        totalRecordedFees += amount;
        // Split fee into creator/treasury/team (50/30/20 of total fee)
        pendingCreatorFees[viewId]  += (amount * CREATOR_BPS)  / 100;
        pendingTreasuryFees[viewId] += (amount * TREASURY_BPS) / 100;
        pendingTeamFees[viewId]     += (amount * TEAM_BPS)     / 100;
        (creator); // suppress unused warning
        // Notify Vault of recorded fee (if vault is registered)
        address vault = vaultForView[viewId];
        if (vault != address(0)) {
            MockMarketVault(vault).notifyFeeRecorded(amount);
        }
    }

    /// @notice Simulate creator claiming fees via Vault.releaseFee (correct architecture).
    function claimCreatorFee(uint256 viewId, address vault, address creator) external {
        uint256 amount = pendingCreatorFees[viewId];
        require(amount > 0, "MockFeeManager: nothing to claim");
        pendingCreatorFees[viewId] = 0; // CEI: zero ledger before interaction
        MockMarketVault(vault).releaseFee(creator, amount);
    }

    /// @notice Simulate treasury claiming fees via Vault.releaseFee.
    function claimTreasuryFee(uint256 viewId, address vault, address treasury) external {
        uint256 amount = pendingTreasuryFees[viewId];
        require(amount > 0, "MockFeeManager: nothing to claim");
        pendingTreasuryFees[viewId] = 0;
        MockMarketVault(vault).releaseFee(treasury, amount);
    }

    /// @notice Simulate team claiming fees via Vault.releaseFee.
    function claimTeamFee(uint256 viewId, address vault, address team) external {
        uint256 amount = pendingTeamFees[viewId];
        require(amount > 0, "MockFeeManager: nothing to claim");
        pendingTeamFees[viewId] = 0;
        MockMarketVault(vault).releaseFee(team, amount);
    }
}
