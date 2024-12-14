/** @type import('hardhat/config').HardhatUserConfig */
const dotenv = require("dotenv");
dotenv.config({ path: "~/.env/derion" });

require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-solhint");
require("hardhat-contract-sizer");
require("hardhat-gas-reporter");
require('hardhat-dependency-compiler');
require("solidity-coverage");
require("@nomicfoundation/hardhat-verify");
require('@solidstate/hardhat-4byte-uploader');

require("./scripts/DeployDDLCore.sf");
require("./scripts/utilities");

module.exports = {
    defaultNetwork: 'hardhat',
    solidity: {
        version: "0.8.28",
        settings: {
            evmVersion: 'cancun',
            optimizer: {
                enabled: true,
                runs: 1000000,
            },
            metadata: {
                bytecodeHash: 'none',
            },
            // viaIR: true,
            // outputSelection: { '*': { '*': ['storageLayout'] } },
        },
        compilers: [
            {
                version: "0.6.6",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1000000,
                    },
                    metadata: {
                        bytecodeHash: 'none',
                    },
                },
            }
        ]
    },
    networks: {
        hardhat: {
            accounts: [
                {
                    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
                    balance: "900000000000000000000000000000000000000",
                },
                {
                    privateKey: '0x0000000000000000000000000000000000000000000000000000000000000002',
                    balance: "900000000000000000000000000000000000000",
                },
                {
                    privateKey: '0x0000000000000000000000000000000000000000000000000000000000000003',
                    balance: "900000000000000000000000000000000000000",
                },
            ]
        },
        arbitrum: {
            url: process.env.ARB_MAINNET_PROVIDER ?? 'https://arb1.arbitrum.io/rpc',
            accounts: [
                process.env.MAINNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 900000,
            weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
            utr: '0x8Bd6072372189A12A2889a56b6ec982fD02b0B87',
            chainId: 42161
        },
        bsc: {
            url: process.env.BSC_MAINNET_PROVIDER ?? 'https://bsc-dataseed3.binance.org/',
            accounts: [
                process.env.MAINNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 900000,
            weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            utr: '0x8Bd6072372189A12A2889a56b6ec982fD02b0B87',
            chainId: 56,
            gasPrice: 3e9,
        },
        opbnb: {
            url: process.env.OPBNB_MAINNET_PROVIDER ?? 'https://1rpc.io/opbnb',
            accounts: [
                process.env.MAINNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 900000,
            weth: '0x4200000000000000000000000000000000000006',
            utr: '0x8Bd6072372189A12A2889a56b6ec982fD02b0B87',
            chainId: 204,
            gasPrice: 100,
        },
        arbtestnet: {
            url: process.env.ARB_TESTNET_PROVIDER ?? 'https://endpoints.omniatech.io/v1/arbitrum/goerli/public',
            accounts: [
                process.env.TESTNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 20000,
            chainId: 421613
        },
        optestnet: {
            url: process.env.OP_TESTNET_PROVIDER ?? 'https://goerli.optimism.io',
            accounts: [
                process.env.TESTNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 20000,
            chainId: 420
        },
        basetestnet: {
            url: process.env.BASE_TESTNET_PROVIDER ?? 'https://goerli.base.org',
            accounts: [
                process.env.TESTNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 20000,
            chainId: 84531
        },
        base: {
            url: process.env.BASE_MAINNET_PROVIDER ?? 'https://mainnet.base.org',
            accounts: [
                process.env.MAINNET_DEPLOYER ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
            timeout: 20000,
            weth: '0x4200000000000000000000000000000000000006',
            chainId: 8453
        },
        ganache: {
            url: 'http://127.0.0.1:8545',
            // kick balcony people guess oppose verb faint explain spoil learn that pool
            accounts: [
                '60f5906de1edfc4d14eb4aea49ed4c06641bbdbd5a56092392308e9730598373',
                '70ddda4400c15d2daa517f858defab22c8a5d9adeaf3d74caa5ca86a5959ddd9'
            ],
            timeout: 900000,
            chainId: 1337
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            accounts: [
                process.env.LOCAL_DEPLOYER ?? '0x28d1bfbbafe9d1d4f5a11c3c16ab6bf9084de48d99fbac4058bdfa3c80b2908c',
                '0x0000000000000000000000000000000000000000000000000000000000000001'
            ]
        }
    },
    etherscan: {
        customChains: [{
            network: "opbnb",
            chainId: 204,
            urls: {
                apiURL: "https://api-opbnb.bscscan.com/api",
                browserURL: "https://opbnb.bscscan.com/"
            }
        }],
        apiKey: {
            ethereum: process.env.SCAN_API_KEY_1,
            arbitrumOne: process.env.SCAN_API_KEY_42161,
            bsc: process.env.SCAN_API_KEY_56,
            opbnb: process.env.SCAN_API_KEY_204,
        }
    },
    mocha: {
        timeout: 100000000
    },
    dependencyCompiler: {
        paths: [
            '@derion/utr/contracts/UniversalTokenRouter.sol'
        ]
    },
    contractSizer: {
        alphaSort: true,
        disambiguatePaths: false,
        runOnCompile: true,
        strict: true,
        only: [],
    }
};
