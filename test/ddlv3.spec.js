const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt, encodePayload } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const FROM_ROUTER   = 10;
const PAYMENT       = 0;
const TRANSFER      = 1;
const ALLOWANCE     = 2;
const CALL_VALUE    = 3;

const AMOUNT_EXACT = 0
const AMOUNT_ALL = 1
const EIP_ETH = 0
const ID_721_ALL = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ID_721_ALL"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("DDL v3", function () {
    async function deployDDLv2() {
        const [owner, accountA] = await ethers.getSigners();
        const signer = owner;
        // deploy pool factory
        const PoolFactory = await ethers.getContractFactory("PoolFactory")
        const poolFactory = await PoolFactory.deploy()
        // deploy UTR
        const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
        const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
        const utr = await UniversalRouter.deploy()
        await utr.deployed()
        // deploy token1155
        const Token = await ethers.getContractFactory("Token")
        const derivable1155 = await Token.deploy(
            "Test/",
            utr.address
        )
        await derivable1155.deployed()
        // erc20 factory
        const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
        const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
        const usdc = await erc20Factory.deploy(numberToWei(10000000000));
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
            token0: usdc.address,
            token1: weth.address,
            fee: 500,
            tickLower: Math.ceil(-887272 / 10) * 10,
            tickUpper: Math.floor(887272 / 10) * 10,
            amount0Desired: pe('150000'),
            amount1Desired: pe('100'),
            amount0Min: 0,
            amount1Min: 0,
            recipient: owner.address,
            deadline: new Date().getTime() + 100000
        }, {
            value: pe('100'),
            gasLimit: 30000000
        })
        await time.increase(1000);
        // deploy logic
        const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")
        const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
        await asymptoticPerpetual.deployed()
        // deploy ddl pool
        const oracle = ethers.utils.hexZeroPad(
            bn(1).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
            32,
        )
        const params = {
            utr: utr.address,
            token: derivable1155.address,
            logic: asymptoticPerpetual.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(38).shl(112),
            k: 5,
            a: pe(1),
            b: pe(1),
            halfLife: HALF_LIFE // ten years
        }
        const poolAddress = await poolFactory.computePoolAddress(params)
        await weth.deposit({
            value: pe("1000000")
        })
        await weth.transfer(poolAddress, pe("10000"));
        await poolFactory.createPool(params);
        const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))
        // deploy helper
        const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
        const stateCalHelper = await StateCalHelper.deploy()
        await stateCalHelper.deployed()

        const DerivableHelper = await ethers.getContractFactory("contracts/test/Helper.sol:Helper")
        const derivableHelper = await DerivableHelper.deploy(
            derivablePool.address,
            derivable1155.address,
            stateCalHelper.address
        )
        await derivableHelper.deployed()
        // setup accA
        await weth.connect(accountA).deposit({
            value: pe("1000000")
        })
        await usdc.transfer(accountA.address, pe("100000000"))
        return {
            owner,
            accountA,
            weth,
            usdc,
            utr,
            uniswapFactory,
            derivablePool,
            derivable1155,
            uniswapRouter,
            derivableHelper,
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
            amountIn: pe("1000000000"),
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

    describe("Pool", function () {
        async function testRIn(sideIn, amountIn, sideOut, isUseUTR) {
            const { owner, weth, derivablePool, utr, derivable1155, stateCalHelper } = await loadFixture(deployDDLv2)
            await weth.approve(derivablePool.address, MaxUint256)
            const payer = isUseUTR ? owner.address : AddressZero
            const wethBefore = await weth.balanceOf(owner.address)
            if (isUseUTR) {
                await weth.approve(utr.address, MaxUint256)
                await utr.exec([], [{
                    inputs: [{
                        mode: PAYMENT,
                        eip: 20,
                        token: weth.address,
                        id: 0,
                        amountSource: AMOUNT_EXACT,
                        amountInMax: pe(amountIn),
                        recipient: derivablePool.address,
                    }],
                    flags: 0,
                    code: derivablePool.address,
                    data: (await derivablePool.populateTransaction.swap(
                        sideIn,
                        sideOut,
                        stateCalHelper.address,
                        encodePayload(0, sideIn, sideOut, pe(amountIn), derivable1155.address),
                        payer,
                        owner.address
                    )).data,
                }], opts)
            }
            else {
                await weth.approve(derivablePool.address, MaxUint256)
                await derivablePool.swap(
                    sideIn,
                    sideOut,
                    stateCalHelper.address,
                    encodePayload(0, sideIn, sideOut, pe(amountIn), derivable1155.address),
                    payer,
                    owner.address,
                    opts
                )
            }
            const wethAfter = await weth.balanceOf(owner.address)
            const wethChanged = wethBefore.sub(wethAfter)
            expect(wethChanged).equal(pe(amountIn))
        }
        it("weth -> lp: Non UTR", async function () {
            await testRIn(SIDE_R, "1", SIDE_C, false)
        })
        it("weth -> long: Non UTR", async function () {
            await testRIn(SIDE_R, "0.5", SIDE_A, false)
        })
        it("weth -> short: Non UTR", async function () {
            await testRIn(SIDE_R, "0.5", SIDE_B, false)
        })

        it("weth -> lp: UTR", async function () {
            await testRIn(SIDE_R, "1", SIDE_C, true)
        })
        it("weth -> long: UTR", async function () {
            await testRIn(SIDE_R, "0.5", SIDE_A, true)
        })
        it("weth -> short: UTR", async function () {
            await testRIn(SIDE_R, "0.5", SIDE_B, true)
        })

        async function testROut(sideIn, amountIn, sideOut, isUseUTR) {
            const { owner, weth, derivablePool, derivable1155, utr, stateCalHelper } = await loadFixture(deployDDLv2)
            const convertedId = convertId(sideIn, derivablePool.address)
            const payer = isUseUTR ? owner.address : AddressZero
            await weth.approve(derivablePool.address, MaxUint256)
            const tokenBefore = await derivable1155.balanceOf(owner.address, convertedId)
            if (isUseUTR) {
                await weth.approve(utr.address, MaxUint256)
                await utr.exec([], [{
                    inputs: [{
                        mode: PAYMENT,
                        eip: 1155,
                        token: derivable1155.address,
                        id: convertedId,
                        amountSource: AMOUNT_EXACT,
                        amountInMax: pe(amountIn),
                        recipient: derivablePool.address,
                    }],
                    flags: 0,
                    code: derivablePool.address,
                    data: (await derivablePool.populateTransaction.swap(
                        sideIn,
                        sideOut,
                        stateCalHelper.address,
                        encodePayload(0, sideIn, sideOut, pe(amountIn), derivable1155.address),
                        payer,
                        owner.address
                    )).data,
                }], opts)
            } else {
                await derivablePool.swap(
                    sideIn,
                    sideOut,
                    stateCalHelper.address,
                    encodePayload(0, sideIn, sideOut, pe(amountIn), derivable1155.address),
                    AddressZero,
                    owner.address,
                    opts
                )
            }
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertedId)
            const tokenChanged = tokenBefore.sub(tokenAfter)
            expect(tokenChanged).equal(pe(amountIn))
        }
        it("lp -> weth: Non UTR", async function () {
            await testROut(SIDE_C, "1", SIDE_R, false)
        })
        it("long -> weth: Non UTR", async function () {
            await testROut(SIDE_A, "0.1", SIDE_R, false)
        })
        it("short -> weth: Non UTR", async function () {
            await testROut(SIDE_B, "0.1", SIDE_R, false)
        })

        it("lp -> weth: UTR", async function () {
            await testROut(SIDE_C, "1", SIDE_R, true)
        })
        it("long -> weth: UTR", async function () {
            await testROut(SIDE_A, "0.1", SIDE_R, true)
        })
        it("short -> weth: UTR", async function () {
            await testROut(SIDE_B, "0.1", SIDE_R, true)
        })

        async function testRInROut(side, amount) {
            const { owner, weth, derivablePool, utr, derivableHelper, stateCalHelper, derivable1155 } = await loadFixture(deployDDLv2)
            const before = await weth.balanceOf(owner.address)
            await weth.approve(utr.address, MaxUint256)
            await utr.exec([],
                [
                    {
                        inputs: [{
                            mode: PAYMENT,
                            eip: 20,
                            token: weth.address,
                            id: 0,
                            amountSource: AMOUNT_EXACT,
                            amountInMax: pe(amount),
                            recipient: derivablePool.address,
                        }],
                        flags: 0,
                        code: derivablePool.address,
                        data: (await derivablePool.populateTransaction.swap(
                            SIDE_R,
                            side,
                            stateCalHelper.address,
                            encodePayload(0, SIDE_R, side, pe(amount), derivable1155.address),
                            owner.address,
                            derivableHelper.address
                        )).data,
                    },
                    {
                        inputs: [],
                        flags: 0,
                        code: derivableHelper.address,
                        data: (await derivableHelper.populateTransaction.swapInAll(
                            side,
                            SIDE_R,
                            AddressZero,
                            owner.address
                        )).data,
                    }
                ], opts)
            const after = await weth.balanceOf(owner.address)
            expect(before).gt(after)
            const rate = before.mul(100000).div(after) / 100000
            expect(rate).closeTo(1, 0.1)
        }

        it("weth -> long -> weth: 1e", async function () {
            await testRInROut(SIDE_A, "1")
        })
        it("weth -> short -> weth: 1e", async function () {
            await testRInROut(SIDE_B, "1")
        })
        it("weth -> lp -> weth: 1e", async function () {
            await testRInROut(SIDE_C, "1")
        })

        it("weth -> long -> weth: 20e", async function () {
            await testRInROut(SIDE_A, "20")
        })
        it("weth -> short -> weth: 20e", async function () {
            await testRInROut(SIDE_B, "20")
        })
        it("weth -> lp -> weth: 20e", async function () {
            await testRInROut(SIDE_C, "20")
        })

        async function testPriceChange(isLong = true, wethAmountIn, priceChange, expected) {
            const { owner, weth, uniswapRouter, usdc, derivablePool, derivable1155, accountA, stateCalHelper } = await loadFixture(deployDDLv2)
            // swap weth -> long
            await weth.approve(derivablePool.address, MaxUint256)
            const wethBefore = await weth.balanceOf(owner.address)
            const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(isLong ? SIDE_A : SIDE_B, derivablePool.address))
            await derivablePool.swap(
                SIDE_R,
                isLong ? SIDE_A : SIDE_B,
                stateCalHelper.address,
                encodePayload(0, SIDE_R, isLong ? SIDE_A : SIDE_B, pe(wethAmountIn), derivable1155.address),
                AddressZero,
                owner.address,
                opts
            )
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(isLong ? SIDE_A : SIDE_B, derivablePool.address))
            // change price
            await weth.connect(accountA).approve(uniswapRouter.address, MaxUint256)
            await usdc.connect(accountA).approve(uniswapRouter.address, MaxUint256)
            await swapToSetPriceV3({
                account: accountA,
                baseToken: weth,
                quoteToken: usdc,
                uniswapRouter: uniswapRouter,
                initPrice: 1500,
                targetPrice: priceChange
            })
            await time.increase(1000);
            // swap back long -> weth
            await derivablePool.swap(
                isLong ? SIDE_A : SIDE_B,
                SIDE_R,
                stateCalHelper.address,
                encodePayload(0, isLong ? SIDE_A : SIDE_B, SIDE_R, tokenAfter.sub(tokenBefore), derivable1155.address),
                AddressZero,
                owner.address,
                opts
            )
            const wethAfter = await weth.balanceOf(owner.address)
            const actual = Number(fe(wethAfter.sub(wethBefore)))
            // console.log(actual)
            return expect(actual / expected).to.be.closeTo(1, 0.01)
        }

        it("Long +10%", async function () {
            await testPriceChange(true, 1, 1500 + (1500 * 10 / 100), 0.269)
        })
        it("Long +20%", async function () {
            await testPriceChange(true, 1, 1500 + (1500 * 20 / 100), 0.577)
        })
        it("Long +50%", async function () {
            await testPriceChange(true, 1, 1500 + (1500 * 50 / 100), 1.755)
        })
        it("Long +100%", async function () {
            await testPriceChange(true, 1, 1500 + (1500 * 100 / 100), 4.656)
        })
        it("Long -10%", async function () {
            await testPriceChange(true, 1, 1500 - (1500 * 10 / 100), -0.231)
        })
        it("Long -20%", async function () {
            await testPriceChange(true, 1, 1500 - (1500 * 20 / 100), -0.427)
        })
        it("Long -50%", async function () {
            await testPriceChange(true, 1, 1500 - (1500 * 50 / 100), -0.823)
        })
        it("Long -99%", async function () {
            await testPriceChange(true, 1, 1500 - (1500 * 99 / 100), -0.999)
        })
        it("Short +10%", async function () {
            await testPriceChange(false, 1, 1500 + (1500 * 10 / 100), -0.212)
        })
        it("Short +20%", async function () {
            await testPriceChange(false, 1, 1500 + (1500 * 20 / 100), -0.366)
        })
        it("Short +50%", async function () {
            await testPriceChange(false, 1, 1500 + (1500 * 50 / 100), -0.637)
        })
        it("Short +100%", async function () {
            await testPriceChange(false, 1, 1500 + (1500 * 100 / 100), -0.823)
        })
        it("Short -10%", async function () {
            await testPriceChange(false, 1, 1500 - (1500 * 10 / 100), 0.301)
        })
        it("Short -20%", async function () {
            await testPriceChange(false, 1, 1500 - (1500 * 20 / 100), 0.746)
        })
        it("Short -50%", async function () {
            await testPriceChange(false, 1, 1500 - (1500 * 50 / 100), 4.655)
        })
        it("Short -99%", async function () {
            await testPriceChange(false, 1, 1500 - (1500 * 99 / 100), 5168.547)
        })
    })
})

