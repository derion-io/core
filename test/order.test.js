const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt, encodePayload, weiToNumber, attemptSwap, feeToOpenRate } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Order", function () {
    async function fixture() {
        const [owner, accountA, accountB] = await ethers.getSigners();
        const signer = owner;
        // // deploy oracle library
        const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
        const oracleLibrary = await OracleLibrary.deploy()
        await oracleLibrary.deployed()

        // deploy pool factory
        const PoolFactory = await ethers.getContractFactory("PoolFactory")
        const poolFactory = await PoolFactory.deploy(
            owner.address
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
        const erc20Factory = await ethers.getContractFactory("USDC")
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
        const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1812.79932666 / 10**12 : 1, quoteTokenIndex ? 1 : 1812.79932666 / 10**12)
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
            amount0Desired: quoteTokenIndex ? pe('100') : pe('1812.79932666'),
            amount1Desired: quoteTokenIndex ? pe('1812.79932666') : pe('100'),
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
            mark: bn('14799820757664578262474009922764800'),
            k: bn(64),
            a: bn('400000000000000'),
            b: bn('400000000000000'),
            initTime: 0,
            halfLife: bn(HALF_LIFE),
            premiumRate: 0,
            minExpirationD: 0,
            minExpirationC: 0,
            discountRate: 0,
            feeHalfLife: 0,
            openRate: feeToOpenRate(0)
        }
        const poolAddress = await poolFactory.computePoolAddress(params)
        await weth.deposit({
            value: pe("10000000000000000000")
        })
        await weth.transfer(poolAddress, pe(0.01));

        await poolFactory.createPool(params);
        const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", await poolFactory.computePoolAddress(params))
        // deploy helper
        const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
        const stateCalHelper = await StateCalHelper.deploy(
            derivable1155.address,
            weth.address
        )
        await stateCalHelper.deployed()

        // setup accA
        await weth.connect(accountA).deposit({
            value: pe("10000000000000000000")
        })
        await usdc.transfer(accountA.address, pe("10000000000000000000"))
        // setup accB
        await weth.connect(accountB).deposit({
            value: pe("10000000000000000000")
        })
        await usdc.transfer(accountB.address, pe("10000000000000000000"))
        return {
            owner,
            accountA,
            accountB,
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

    async function swapToSetPriceV3({ account, quoteToken, baseToken, uniswapRouter, initPrice, targetPrice }) {
        const quoteTokenIndex = baseToken.address.toLowerCase() < quoteToken.address.toLowerCase() ? 1 : 0
        const priceX96 = encodeSqrtX96(quoteTokenIndex ? targetPrice : 1, quoteTokenIndex ? 1 : targetPrice)
        const tx = await uniswapRouter.connect(account).exactInputSingle({
            payer: account.address,
            tokenIn: (initPrice < targetPrice) ? quoteToken.address : baseToken.address,
            tokenOut: (initPrice < targetPrice) ? baseToken.address : quoteToken.address,
            fee: 500,
            sqrtPriceLimitX96: priceX96,
            recipient: account.address,
            deadline: new Date().getTime() + 100000,
            amountIn: pe("1000000000000000000"),
            amountOutMinimum: 0,
        }, opts)
        await tx.wait(1)
    }

    function convertId(side, poolAddress) {
        switch (side) {
            case SIDE_R:
                return packId(SIDE_R, poolAddress)
            case SIDE_A:
                return packId(SIDE_A, poolAddress)
            case SIDE_B:
                return packId(SIDE_B, poolAddress)
            case SIDE_C:
                return packId(SIDE_C, poolAddress)
            default:
                return 0
        }
    }

    describe("Multi position", function () {
        it("Long 1e - short 1e - price -3%", async function () {
            const {accountA, accountB, weth, derivablePool, derivable1155, usdc, uniswapRouter, stateCalHelper} = await loadFixture(fixture)
            let txSignerA = await weth.connect(accountA)
            let txSignerB = await weth.connect(accountB)
            
            await txSignerA.approve(derivablePool.address, MaxUint256)
            await txSignerB.approve(derivablePool.address, MaxUint256)

            txSignerA = await derivablePool.connect(accountA)
            txSignerB = await derivablePool.connect(accountB)

            // swap eth -> long
            
            const longTokenBefore = await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePool.address))
            await txSignerA.swap(
                SIDE_R,
                SIDE_A,
                stateCalHelper.address,
                encodePayload(0, SIDE_R, SIDE_A, pe(1), derivable1155.address),
                0,
                AddressZero,
                accountA.address,
                opts
            )
            const longTokenAfter = await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePool.address))
            const longToken = longTokenAfter.sub(longTokenBefore)
            // swap eth -> short
            
            const shortTokenBefore = await derivable1155.balanceOf(accountB.address, convertId(SIDE_B, derivablePool.address))
            await txSignerB.swap(
                SIDE_R,
                SIDE_B,
                stateCalHelper.address,
                encodePayload(0, SIDE_R, SIDE_B, pe(1), derivable1155.address),
                0,
                AddressZero,
                accountB.address,
                opts
            )
            
            const shortTokenAfter = await derivable1155.balanceOf(accountB.address, convertId(SIDE_B, derivablePool.address))
            const shortToken = shortTokenAfter.sub(shortTokenBefore)

            // swap back
            const bWethBefore = await weth.balanceOf(accountB.address)
            const aWethBefore = await weth.balanceOf(accountA.address)
            await txSignerA.swap(
                SIDE_A,
                SIDE_R,
                stateCalHelper.address,
                encodePayload(0, SIDE_A, SIDE_R, longToken, derivable1155.address),
                0,
                AddressZero,
                accountA.address,
                opts
            )

            await txSignerB.swap(
                SIDE_B,
                SIDE_R,
                stateCalHelper.address,
                encodePayload(0, SIDE_B, SIDE_R, shortToken, derivable1155.address),
                0,
                AddressZero,
                accountB.address,
                opts
            )

            const aWethAfter = await weth.balanceOf(accountA.address)
            const bWethAfter = await weth.balanceOf(accountB.address)

            const longValue = weiToNumber(aWethAfter.sub(aWethBefore))
            const shortValue = weiToNumber(bWethAfter.sub(bWethBefore))

            expect(longValue/shortValue).closeTo(1, 0.00001)
        })
    })
})