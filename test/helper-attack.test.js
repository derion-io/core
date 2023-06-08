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
    encodeSqrtX96, weiToNumber, swapToSetPriceV3, encodePayload,
} = require("./shared/utilities")
const { _init } = require("./shared/AsymptoticPerpetual")

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

const PAYMENT = 0;
const CALL_VALUE = 2;

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Helper Attacks", function () {
    async function deployDDLv2() {
        const [owner, accountA] = await ethers.getSigners();
        const signer = owner;
        // deploy oracle library
        const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
        const oracleLibrary = await OracleLibrary.deploy()
        await oracleLibrary.deployed()
        // deploy pool factory
        const PoolFactory = await ethers.getContractFactory("PoolFactory")
        const poolFactory = await PoolFactory.deploy(owner.address)
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

        // deploy helper
        const BadHelper = await ethers.getContractFactory("BadHelper")
        const badHelper = await BadHelper.deploy(
            derivable1155.address,
            weth.address
        )
        await badHelper.deployed()

        // deploy helper 1
        const BadHelper1 = await ethers.getContractFactory("BadHelper1")
        const badHelper1 = await BadHelper1.deploy(
            derivable1155.address,
            weth.address
        )
        await badHelper1.deployed()

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
            a: pe(1),
            b: pe(1),
            initTime: 0,
            halfLife: bn(HALF_LIFE),
            premiumRate: bn(1).shl(128).div(2),
            minExpirationD: 0,
            minExpirationC: 0,
            discountRate: 0,
            feeHalfLife: 0
        }
        params = await _init(oracleLibrary, pe(5), params)
        const poolAddress = await poolFactory.computePoolAddress(params)
        await stateCalHelper.createPool(
            params,
            poolFactory.address, {
                value: pe(5),
            },
        )

        const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", poolAddress)

        let params1 = {
            utr: utr.address,
            token: derivable1155.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(38).shl(128),
            k: bn(2),
            a: pe(1),
            b: pe(1),
            initTime: 0,
            halfLife: bn(HALF_LIFE),
            premiumRate: bn(1).shl(128).div(2),
            minExpirationD: 0,
            minExpirationC: 0,
            discountRate: 0,
            feeHalfLife: 0
        }
        params1 = await _init(oracleLibrary, pe(5), params1)
        const poolAddress1 = await poolFactory.computePoolAddress(params1)
        await weth.deposit({
            value: pe("1000000000000000000")
        })
        // await weth.transfer(poolAddress1, pe("10000"));
        // await poolFactory.createPool(params1);
        await stateCalHelper.createPool(
            params1,
            poolFactory.address,
            {
                value: pe(5),
            }
        )

        const derivablePool1 = await ethers.getContractAt("AsymptoticPerpetual", poolAddress1)

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
            stateCalHelper,
            badHelper,
            badHelper1
        }
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
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePool.address,
                    sideOut: sideOut,
                    poolOut: derivablePool1.address,
                    amountIn: pe(amountIn),
                    expiration: 0,
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
                    expiration: 0,
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
                    expiration: 0,
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
                    expiration: 0,
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

    describe("Helper attack", function () {
        async function helperAttackBuyIn (sideOut, amount, revertReason) {
            const {derivablePool, badHelper, owner, weth, usdc, uniswapRouter} = await loadFixture(deployDDLv2)
            await expect(derivablePool.swap(
                SIDE_R,
                sideOut,
                badHelper.address,
                encodePayload(0, SIDE_R, sideOut, pe(amount)),
                0,
                ZERO_ADDRESS,
                owner.address,
                opts
            )).to.be.revertedWith(revertReason)
        }

        async function buyInSwapBack (sideOut, amount, priceChange, helper, revertReason) {
            const {
                derivablePool, 
                stateCalHelper, 
                badHelper,
                owner, 
                weth, 
                usdc, 
                uniswapRouter,
                derivable1155,
                badHelper1
            } = await loadFixture(deployDDLv2)

            const tokenBefore =  await derivable1155.balanceOf(owner.address, convertId(sideOut, derivablePool.address))
            await weth.approve(derivablePool.address, MaxUint256)
            await derivablePool.swap(
                SIDE_R,
                sideOut,
                stateCalHelper.address,
                encodePayload(0, SIDE_R, sideOut, pe(amount)),
                0,
                ZERO_ADDRESS,
                owner.address,
                opts
            )
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(sideOut, derivablePool.address))
            const inputAmount = tokenAfter.sub(tokenBefore)
            
            await swapToSetPriceV3({
                account: owner, 
                quoteToken: usdc, 
                baseToken: weth, 
                uniswapRouter, 
                initPrice: 1500, 
                targetPrice: 1500 * priceChange
            })
            await time.increase(1000);

            await derivable1155.setApprovalForAll(derivablePool.address, true);
            await expect(derivablePool.swap(
                sideOut,
                SIDE_R,
                helper ? badHelper1.address : badHelper.address,
                encodePayload(0, sideOut, SIDE_R, inputAmount),
                0,
                ZERO_ADDRESS,
                owner.address,
                opts
            )).to.be.revertedWith(revertReason)
        }

        it("sideIn R | Try to break rA1 >= rA", async function() {
            await helperAttackBuyIn(SIDE_B, 1, "MI:R")
        })

        it("sideIn R | Try to break rB1 >= rB", async function() {
            await helperAttackBuyIn(SIDE_A, 1, "MI:R")
        })

        it("sideIn A | Try to break state.R >= state1.R", async function() {
            await buyInSwapBack(SIDE_A, 1, 2, 0, "MI:NR")
        })

        it("sideIn A | Try to break rB1 >= rB", async function() {
            await buyInSwapBack(SIDE_A, 1, 2, 1, "MI:A")
        })

        it("sideIn B | Try to break rA1 >= rA", async function() {
            await buyInSwapBack(SIDE_B, 1, 2, 1, "MI:NA")
        })

        it("sideIn C | Try to break rB1 >= rB", async function() {
            await buyInSwapBack(SIDE_C, 1, 2, 1, "MI:NB")
        })
    })
})

