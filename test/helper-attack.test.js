const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const {solidity} = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const {MaxUint256} = ethers.constants
const {
    bn,
    numberToWei,
    packId,
    swapToSetPriceMock,
} = require("./shared/utilities")
const { calculateInitParams } = require("./shared/AsymptoticPerpetual")

const pe = (x) => ethers.utils.parseEther(String(x))

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30
const SIDE_NATIVE = 0x01

const PAYMENT = 0;
const CALL_VALUE = 2;

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Helper Attacks", function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        halfLife: bn(HALF_LIFE),
        premiumHL: bn(1).shl(128).div(2),
    }, {
        ...baseParams,
        k: bn(2),
        halfLife: bn(HALF_LIFE),
        premiumHL: bn(1).shl(128).div(2),
    }], {
        callback: async ({derivablePools, weth, usdc, derivable1155, stateCalHelper, accountA}) => {
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
            
            const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
            const derivableHelper = await DerivableHelper.deploy(
                derivablePools[0].contract.address,
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
                badHelper,
                badHelper1,
                derivableHelper
            }
        }
    })

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
                derivablePools,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(fixture)
            await weth.approve(derivablePools[0].contract.address, MaxUint256)
            const balanceInBefore = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePools[0].contract.address))
            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePools[1].contract.address))
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 1155,
                    token: derivable1155.address,
                    id: packId(sideIn, derivablePools[0].contract.address),
                    amountIn: pe(amountIn),
                    recipient: derivablePools[0].contract.address,
                }],
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePools[0].contract.address,
                    sideOut: sideOut,
                    poolOut: derivablePools[1].contract.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }], opts)

            const balanceInAfter = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePools[0].contract.address))
            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePools[1].contract.address))

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
        it("check leftOver", async function () {
            const {
                owner,
                weth,
                derivablePools,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(fixture)
            expect(await weth.balanceOf(stateCalHelper.address)).equal(0)
            // transfer a small amount of token_r to helper contract
            await weth.transfer(stateCalHelper.address, pe(0.00001))
            expect(await weth.balanceOf(stateCalHelper.address)).equal(10000000000000)
            await weth.approve(derivablePools[0].contract.address, MaxUint256)
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 1155,
                    token: derivable1155.address,
                    id: packId(SIDE_A, derivablePools[0].contract.address),
                    amountIn: pe(0.0001),
                    recipient: derivablePools[0].contract.address,
                }],
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: SIDE_A,
                    poolIn: derivablePools[0].contract.address,
                    sideOut: SIDE_B,
                    poolOut: derivablePools[1].contract.address,
                    amountIn: pe(0.0001),
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }], opts)
            expect(await weth.balanceOf(stateCalHelper.address)).equal(0)
        })
    })

    describe("Swap in 1 pool", function () {
        async function testSwap(sideIn, amountIn, sideOut) {
            const {
                owner,
                weth,
                derivablePools,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(fixture)
            await weth.deposit({value: numberToWei(amountIn)})
            await weth.approve(utr.address, MaxUint256)

            const balanceInBefore = await weth.balanceOf(owner.address)
            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePools[0].contract.address))
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    token: sideIn === SIDE_R ? weth.address : derivable1155.address,
                    eip: sideIn === SIDE_R ? 20 : 1155,
                    id: sideIn === SIDE_R ? 0 : packId(sideIn, derivablePools[0].contract.address),
                    amountIn: pe(amountIn),
                    recipient: derivablePools[0].contract.address,
                }],
                // flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePools[0].contract.address,
                    sideOut: sideOut,
                    poolOut: derivablePools[0].contract.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }], opts)

            const balanceInAfter =  await weth.balanceOf(owner.address)
            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePools[0].contract.address))

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
                derivablePools,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(fixture)
            await weth.deposit({value: numberToWei(amountIn)})
            await weth.approve(utr.address, MaxUint256)

            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePools[0].contract.address))
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
                    poolIn: derivablePools[0].contract.address,
                    sideOut: sideOut,
                    poolOut: derivablePools[0].contract.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }], {
                ...opts,
                value: pe(amountIn),
            })

            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePools[0].contract.address))

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
                derivablePools,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(fixture)
            await weth.deposit({
                value: numberToWei(1000)
            })
            const balanceInBefore = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePools[0].contract.address))
            const balanceOutBefore = await owner.provider.getBalance(owner.address)
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    token: sideIn === SIDE_R ? weth.address : derivable1155.address,
                    eip: sideIn === SIDE_R ? 20 : 1155,
                    id: sideIn === SIDE_R ? 0 : packId(sideIn, derivablePools[0].contract.address),
                    amountIn: balanceInBefore,
                    recipient: derivablePools[0].contract.address,
                }],
                // flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePools[0].contract.address,
                    sideOut: SIDE_NATIVE,
                    poolOut: derivablePools[0].contract.address,
                    amountIn: balanceInBefore,
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }], opts)

            const balanceInAfter = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePools[0].contract.address))
            expect(balanceInAfter, 'input balance must be exhausted').equal(0)

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

    it("Helper create pool", async function () {
        const {stateCalHelper, params, fetchPrice, poolFactory} = await loadFixture(fixture)

        function toConfig(params) {
            return {
              FETCHER: params.fetcher,
              ORACLE: params.oracle,
              TOKEN_R: params.reserveToken,
              MARK: params.mark,
              K: params.k,
              INTEREST_HL: params.halfLife,
              PREMIUM_HL: params.premiumHL,
              MATURITY: params.maturity,
              MATURITY_VEST: params.maturityVest,
              MATURITY_RATE: params.maturityRate,
              OPEN_RATE: params.openRate,
            }
          }

        const params1 = {
            ...params[0],
            k: bn(20)
        }

        const config = toConfig(params1) 
        const initParams = await calculateInitParams(config, fetchPrice, numberToWei(5))
        await stateCalHelper.createPool(config, initParams, poolFactory.address, {
            value: numberToWei(5)
        })
    })

    describe("Helper attack", function () {
        async function helperAttackBuyIn (sideOut, amount, revertReason) {
            const {derivablePools, badHelper, owner, weth, usdc, uniswapRouter} = await loadFixture(fixture)
            await expect(derivablePools[0].swap(
                SIDE_R,
                sideOut,
                pe(amount),
                {
                    helper: badHelper.address
                }
            )).to.be.revertedWith(revertReason)
        }

        async function buyInSwapBack (sideOut, amount, priceChange, helper, revertReason) {
            const {
                derivablePools,
                badHelper,
                owner, 
                weth, 
                usdc, 
                uniswapPair,
                derivable1155,
                badHelper1
            } = await loadFixture(fixture)

            const tokenBefore =  await derivable1155.balanceOf(owner.address, convertId(sideOut, derivablePools[0].contract.address))
            await weth.approve(derivablePools[0].contract.address, MaxUint256)
            await derivablePools[0].swap(
                SIDE_R,
                sideOut,
                pe(amount),
            )
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(sideOut, derivablePools[0].contract.address))
            const inputAmount = tokenAfter.sub(tokenBefore)
            
            await swapToSetPriceMock({
                baseToken: weth,
                quoteToken: usdc,
                uniswapPair,
                targetTwap: 1500 * priceChange,
                targetSpot: 1500 * priceChange
            })
            await time.increase(1000);

            await derivable1155.setApprovalForAll(derivablePools[0].contract.address, true);
            await expect(derivablePools[0].swap(
                sideOut,
                SIDE_R,
                inputAmount,
                {
                    helper: helper ? badHelper1.address : badHelper.address,
                }
            )).to.be.revertedWith(revertReason)
        }

        it("sideIn R | Try to break rA1 >= rA", async function() {
            await helperAttackBuyIn(SIDE_B, 1, "INVALID_STATE1_R")
        })

        it("sideIn R | Try to break rB1 >= rB", async function() {
            await helperAttackBuyIn(SIDE_A, 1, "INVALID_STATE1_R")
        })

        it("sideIn A | Try to break state.R >= state1.R", async function() {
            await buyInSwapBack(SIDE_A, 1, 2, 0, "INVALID_STATE1_NR")
        })

        it("sideIn A | Try to break rB1 >= rB", async function() {
            await buyInSwapBack(SIDE_A, 1, 2, 1, "INVALID_STATE1_A")
        })

        it("sideIn B | Try to break rA1 >= rA", async function() {
            await buyInSwapBack(SIDE_B, 1, 2, 1, "INVALID_STATE1_NA")
        })

        it("sideIn C | Try to break rB1 >= rB", async function() {
            await buyInSwapBack(SIDE_C, 1, 2, 1, "INVALID_STATE1_NB")
        })
    })
})

