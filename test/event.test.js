const {ethers} = require("hardhat");
const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { _init } = require("./shared/AsymptoticPerpetual")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt, encodePayload, weiToNumber, attemptSwap, feeToOpenRate } = require("./shared/utilities")
const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
const compiledUniswapRouter = require("./compiled/SwapRouter.json");
const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const FROM_ROUTER = 10;
const PAYMENT = 0;
const TRANSFER = 1;
const ALLOWANCE = 2;
const CALL_VALUE = 3;

const EIP_ETH = 0
const ERC_721_BALANCE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ERC_721_BALANCE"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("DDL v3", function () {
    async function deployDDLv2() {
        const [owner, accountA, accountB] = await ethers.getSigners();
        const signer = owner;
        // deploy oracle library
        const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
        const oracleLibrary = await OracleLibrary.deploy()
        await oracleLibrary.deployed()

        // deploy pool factory
        const PoolFactory = await ethers.getContractFactory("PoolFactory")
        const poolFactory = await PoolFactory.deploy(
            owner.address,
            0
        )
        // deploy UTR
        const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
        const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
        const utr = await UniversalRouter.deploy()
        await utr.deployed()

        // deploy descriptor
        const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
        const tokenDescriptor = await TokenDescriptor.deploy()
        await tokenDescriptor.deployed()

        // deploy token1155
        const Token = await ethers.getContractFactory("Token")
        const derivable1155 = await Token.deploy(
            utr.address,
            owner.address,
            tokenDescriptor.address
        )
        await derivable1155.deployed()
        // erc20 factory
        const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
        const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
        const usdc = await erc20Factory.deploy(numberToWei('100000000000000000000'));
        // uniswap factory
        const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
        const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);
        const uniswapFactory = await UniswapFactory.deploy()
        //WETH
        const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
        const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
        const weth = await WETH.deploy();
        // uniswap router
        const compiledUniswapRouter = require("./compiled/SwapRouter.json");
        const UniswapRouter = new ethers.ContractFactory(compiledUniswapRouter.abi, compiledUniswapRouter.bytecode, signer);
        // uniswap PM
        const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
        const Uniswapv3PositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer);
        // setup uniswap
        const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
        const uniswapPositionManager = await Uniswapv3PositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')
        await uniswapFactory.createPool(usdc.address, weth.address, 500)
        const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
        const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
        const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);
        await usdc.approve(uniswapRouter.address, MaxUint256);
        await weth.approve(uniswapRouter.address, MaxUint256);
        const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
        const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
        const a = await uniswapPair.initialize(initPriceX96)
        a.wait(1);
        await time.increase(1000);
        // add liquidity
        await usdc.approve(uniswapPositionManager.address, MaxUint256);
        await weth.approve(uniswapPositionManager.address, MaxUint256);
        await uniswapPositionManager.mint({
            token0: quoteTokenIndex ? weth.address : usdc.address,
            token1: quoteTokenIndex ? usdc.address : weth.address,
            fee: 500,
            tickLower: Math.ceil(-887272 / 10) * 10,
            tickUpper: Math.floor(887272 / 10) * 10,
            amount0Desired: quoteTokenIndex ? pe('100') : pe('150000'),
            amount1Desired: quoteTokenIndex ? pe('150000') : pe('100'),
            amount0Min: 0,
            amount1Min: 0,
            recipient: owner.address,
            deadline: new Date().getTime() + 100000
        }, {
            value: pe('100'),
            gasLimit: 30000000
        })
        await time.increase(1000);
        // deploy ddl pool
        const oracle = ethers.utils.hexZeroPad(
            bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
            32,
        )
        let params = {
            utr: utr.address,
            token: derivable1155.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(38).shl(128),
            k: bn(5),
            a: numberToWei(1),
            b: numberToWei(1),
            initTime: 0,
            halfLife: bn(HALF_LIFE),
            premiumRate: bn(1).shl(128).div(2),
            maturity: 0,
            maturityVest: 0,
            maturityRate: 0,
            discountRate: 0,
            feeHalfLife: 0,
            openRate: feeToOpenRate(0)
        }
        params = await _init(oracleLibrary, pe("5"), params)
        const poolAddress = await poolFactory.computePoolAddress(params)
        await weth.deposit({
            value: pe("10000000000000000000")
        })
        await weth.transfer(poolAddress, pe("5"));

        const tx = await poolFactory.createPool(params);
        const res = await tx.wait(1)
        console.log(res)
        parseDdlLogs(res.logs)
        const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", await poolFactory.computePoolAddress(params))
        // deploy helper
        const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
        const stateCalHelper = await StateCalHelper.deploy(
            derivable1155.address,
            weth.address
        )
        await stateCalHelper.deployed()

        return {
            owner,
            accountA,
            accountB,
            poolFactory,
            weth,
            usdc,
            utr,
            uniswapFactory,
            derivablePool,
            derivable1155,
            uniswapRouter,
            uniswapPositionManager,
            stateCalHelper
        }
    }

    describe("PoolFactory", function () {
        it("PoolCreated", async function () {
            const { owner, accountA, poolFactory } = await loadFixture(deployDDLv2)
        })
    })
})


const parseDdlLogs = (ddlLogs) => {
    const eventInterface = new ethers.utils.Interface(EventsAbi)
    return ddlLogs.map((log) => {
        try {
            const decodeLog = eventInterface.parseLog(log)
            let appName = ''
            try {
                appName = ethers.utils.parseBytes32String(decodeLog.args.topic1)
            } catch (e) {
            }

            let data = decodeLog
            if (appName === 'PoolCreated') {
                const poolCreatedData = ethers.utils.defaultAbiCoder.decode([
                    'address TOKEN',
                    'bytes32 ORACLE',
                    'uint MARK',
                    'uint k',
                    'uint HALF_LIFE',
                    'uint premiumRate',
                    'uint32 maturity',
                    'uint32 maturityVest',
                    'uint maturityRate',
                    'uint discountRate',
                    'uint openRate',
                    'bytes32 poolAddress'
                ], decodeLog.args.data)
                console.log('poolCreatedData', poolCreatedData)
                data = {
                    ...poolCreatedData,
                    TOKEN_R: ethers.utils.getAddress(decodeLog.args.topic3.slice(0, 42))
                }
            }

            return {
                address: data.poolAddress,
                timeStamp: parseInt(log.timeStamp),
                transactionHash: log.transactionHash,
                blockNumber: log.blockNumber,
                index: log.logIndex,
                logIndex: log.transactionHash + '-' + log.logIndex,
                name: appName,
                topics: log.topics,
                args: {
                    ...data,
                },
            }
        } catch (e) {
            console.error(e)
            return {}
        }
    })
}

const EventsAbi =[
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "topic1",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "topic2",
                "type": "bytes32"
            },
            {
                "indexed": true,
                "internalType": "bytes32",
                "name": "topic3",
                "type": "bytes32"
            },
            {
                "indexed": false,
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
            }
        ],
        "name": "Derivable",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "decodePoolData",
        "outputs": [
            {
                "internalType": "bytes",
                "name": "params",
                "type": "bytes"
            },
            {
                "internalType": "address",
                "name": "pool",
                "type": "address"
            }
        ],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "payer",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "poolIn",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "poolOut",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "recipient",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "sideIn",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "sideOut",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountIn",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountOut",
                "type": "uint256"
            }
        ],
        "name": "Swap",
        "type": "event"
    }
]
