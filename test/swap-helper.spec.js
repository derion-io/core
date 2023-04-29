const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const {solidity} = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const {MaxUint256} = ethers.constants
const {
    bn,
    numberToWei,
    packId,
    encodeSqrtX96, weiToNumber,
} = require("./shared/utilities")
const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
const compiledUniswapRouter = require("./compiled/SwapRouter.json");
const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30
const SIDE_NATIVE = '0x000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const FROM_ROUTER = 10;
const PAYMENT = 0;
const TRANSFER = 1;
const ALLOWANCE = 2;
const CALL_VALUE = 2;

const EIP_ETH = 0
const ERC_721_BALANCE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ERC_721_BALANCE"))
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

        // deploy helper
        const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
        const stateCalHelper = await StateCalHelper.deploy(
            derivable1155.address,
            weth.address
        )
        await stateCalHelper.deployed()

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
        // deploy logic
        const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")
        const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
        await asymptoticPerpetual.deployed()
        // deploy ddl pool
        const oracle = ethers.utils.hexZeroPad(
            bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
            32,
        )
        const params = {
            utr: utr.address,
            token: derivable1155.address,
            logic: asymptoticPerpetual.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(38).shl(128),
            k: 5,
            a: pe(1),
            b: pe(1),
            initTime: 0,
            halfLife: HALF_LIFE // ten years
        }
        const poolAddress = await poolFactory.computePoolAddress(params)
        await stateCalHelper.createPool(
            params,
            poolFactory.address, {
                value: pe("10"),
            },
        )

        const derivablePool = await ethers.getContractAt("Pool", poolAddress)

        const params1 = {
            utr: utr.address,
            token: derivable1155.address,
            logic: asymptoticPerpetual.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(38).shl(128),
            k: 2,
            a: pe(1),
            b: pe(1),
            initTime: 0,
            halfLife: HALF_LIFE // ten years
        }
        const poolAddress1 = await poolFactory.computePoolAddress(params1)
        // await weth.deposit({
        //     value: pe("1000000")
        // })
        // await weth.transfer(poolAddress1, pe("10000"));
        // await poolFactory.createPool(params1);
        await stateCalHelper.createPool(
            params1,
            poolFactory.address,
            {
                value: pe("10000"),
            }
        )

        const derivablePool1 = await ethers.getContractAt("Pool", poolAddress1)

        const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
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
            derivablePool1,
            derivable1155,
            uniswapRouter,
            derivableHelper,
            uniswapPositionManager,
            stateCalHelper
        }
    }

    describe("Swap multi pool", function () {
        async function testSwapMultiPool(sideIn, amountIn, sideOut) {
            const {
                owner,
                weth,
                derivablePool,
                derivablePool1,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(deployDDLv2)
            await weth.approve(derivablePool.address, MaxUint256)

            const balanceInBefore = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePool.address))
            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool1.address))
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 1155,
                    token: derivable1155.address,
                    id: packId(sideIn, derivablePool.address),
                    amountIn: pe(amountIn),
                    recipient: derivablePool.address,
                }],
                // flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePool.address,
                    sideOut: sideOut,
                    poolOut: derivablePool1.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address
                })).data,
            }], opts)

            const balanceInAfter = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePool.address))
            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool1.address))

            expect(numberToWei(amountIn).sub((balanceInBefore).sub(balanceInAfter))).lte(1)
            expect(balanceOutBefore.lt(balanceOutAfter)).equal(true)
        }

        it("Pool0/A -> pool1/A", async function () {
            await testSwapMultiPool(SIDE_A, "0.0001", SIDE_A)
        })
        it("Pool0/A -> pool1/B", async function () {
            await testSwapMultiPool(SIDE_A, "0.0001", SIDE_B)
        })
        it("Pool0/A -> pool1/C", async function () {
            await testSwapMultiPool(SIDE_A, "0.0001", SIDE_C)
        })
        it("Pool0/B -> pool1/A", async function () {
            await testSwapMultiPool(SIDE_B, "0.0001", SIDE_A)
        })
        it("Pool0/B -> pool1/B", async function () {
            await testSwapMultiPool(SIDE_B, "0.0001", SIDE_B)
        })
        it("Pool0/B -> pool1/C", async function () {
            await testSwapMultiPool(SIDE_B, "0.0001", SIDE_C)
        })
        it("Pool0/C -> pool1/A", async function () {
            await testSwapMultiPool(SIDE_C, "0.0001", SIDE_A)
        })
        it("Pool0/C -> pool1/B", async function () {
            await testSwapMultiPool(SIDE_C, "0.0001", SIDE_B)
        })
        it("Pool0/C -> pool1/C", async function () {
            await testSwapMultiPool(SIDE_C, "0.0001", SIDE_C)
        })
    })

    describe("Swap in 1 pool", function () {
        async function testSwap(sideIn, amountIn, sideOut) {
            const {
                owner,
                weth,
                derivablePool,
                derivablePool1,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(deployDDLv2)
            await weth.deposit({value: numberToWei(amountIn)})
            await weth.approve(utr.address, MaxUint256)

            const balanceInBefore = await weth.balanceOf(owner.address)
            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool.address))
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    token: sideIn === SIDE_R ? weth.address : derivable1155.address,
                    eip: sideIn === SIDE_R ? 20 : 1155,
                    id: sideIn === SIDE_R ? 0 : packId(sideIn, derivablePool.address),
                    amountIn: pe(amountIn),
                    recipient: derivablePool.address,
                }],
                // flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePool.address,
                    sideOut: sideOut,
                    poolOut: derivablePool.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address
                })).data,
            }], opts)

            const balanceInAfter =  await weth.balanceOf(owner.address)
            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool.address))

            expect(numberToWei(amountIn).sub((balanceInBefore).sub(balanceInAfter))).lte(1)
            expect(balanceOutBefore.lt(balanceOutAfter)).equal(true)
        }

        it("swap R in", async function () {
            await testSwap(SIDE_R, 1, SIDE_B)
        })
    })

    describe("Swap by native", function () {
        async function testSwap(amountIn, sideOut) {
            const {
                owner,
                weth,
                derivablePool,
                derivablePool1,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(deployDDLv2)
            await weth.deposit({value: numberToWei(amountIn)})
            await weth.approve(utr.address, MaxUint256)

            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool.address))
            await utr.exec([], [{
                inputs: [{
                    mode: CALL_VALUE,
                    token: ZERO_ADDRESS,
                    eip: 0,
                    id: 0,
                    amountIn: pe(amountIn),
                    recipient: ZERO_ADDRESS,
                }],
                // flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: SIDE_NATIVE,
                    poolIn: derivablePool.address,
                    sideOut: sideOut,
                    poolOut: derivablePool.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address
                })).data,
            }], {
                ...opts,
                value: pe(amountIn),
            })

            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool.address))

            expect(balanceOutBefore.lt(balanceOutAfter)).equal(true)
        }

        it("swap to SIDE_B by native", async function () {
            await testSwap(1, SIDE_B)
        })
        it("swap to SIDE_A by native", async function () {
            await testSwap(1, SIDE_A)
        })
        it("swap to SIDE_C by native", async function () {
            await testSwap(1, SIDE_C)
        })
    })

    describe("Swap to native", function () {
        async function testSwap(sideIn) {
            const {
                owner,
                weth,
                derivablePool,
                derivablePool1,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(deployDDLv2)
            await weth.deposit({
                value: numberToWei(1000)
            })
            const balanceInBefore = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePool.address))
            const balanceOutBefore = await owner.provider.getBalance(owner.address)
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    token: sideIn === SIDE_R ? weth.address : derivable1155.address,
                    eip: sideIn === SIDE_R ? 20 : 1155,
                    id: sideIn === SIDE_R ? 0 : packId(sideIn, derivablePool.address),
                    amountIn: balanceInBefore,
                    recipient: derivablePool.address,
                }],
                // flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePool.address,
                    sideOut: SIDE_NATIVE,
                    poolOut: derivablePool.address,
                    amountIn: balanceInBefore,
                    payer: owner.address,
                    recipient: owner.address
                })).data,
            }], opts)

            const balanceInAfter = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePool.address))
            const balanceOutAfter = await owner.provider.getBalance(owner.address)

            expect(balanceOutAfter.gt(balanceOutBefore)).equal(true)
            expect(balanceInBefore.gt(balanceInAfter)).equal(true)
        }

        it("swap A to native", async function () {
            await testSwap(SIDE_A)
        })
        it("swap B to native", async function () {
            await testSwap(SIDE_B)
        })
        it("swap C to native", async function () {
            await testSwap(SIDE_C)
        })
    })
})

