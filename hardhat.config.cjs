require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    compilers: [
      { 
        version: "0.8.24", 
        settings: { 
          optimizer: { enabled: true, runs: 200 }, 
          evmVersion: "cancun",
          viaIR: true 
        } 
      }
    ],
  },
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
