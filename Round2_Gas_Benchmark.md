# TradingEngine Gas Benchmark Report

**Date:** July 22, 2026  
**Baseline:** `v1.0.0-architecture-freeze`  
**Compiler:** Solidity 0.8.24, viaIR: true, optimizer: 200 runs, evmVersion: cancun

## Function Gas Usage

| Function | Min Gas | Max Gas | Avg Gas | Calls |
|---|---|---|---|---|
| `buy()` | 161,105 | 377,517 | 316,079 | 33 |
| `sell()` | — | — | 187,971 | 4 |

## Deployment Gas

| Contract | Gas Used | % of Block Limit |
|---|---|---|
| `TradingEngine` | 1,363,566 | 2.3% |

## Analysis

The high variance in `buy()` gas (161k–377k) is expected and explained by two factors. First, the first call to a new storage slot (cold SLOAD/SSTORE) costs significantly more than subsequent calls to warm slots. Second, the `MockPulseFactory.getView()` returns a large struct, which contributes to memory allocation overhead. The `_getViewFields()` optimization (Fix ⑦) reduces this by only using three fields from the struct.

The `sell()` average of 187,971 gas is lower than `buy()` because it does not execute a `safeTransferFrom` (the token pull from the user), which is one of the most expensive ERC20 operations.

## Baseline Established

This report establishes the Round 2 gas baseline. All subsequent Rounds must compare against these numbers to detect performance regressions.

| Metric | Round 2 Baseline |
|---|---|
| `buy()` avg gas | 316,079 |
| `sell()` avg gas | 187,971 |
| `TradingEngine` deployment | 1,363,566 |
