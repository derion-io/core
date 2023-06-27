const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { _init } = require("./shared/AsymptoticPerpetual")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, swapToSetPriceMock, packId, encodeSqrtX96, encodePriceSqrt, encodePayload, weiToNumber, attemptSwap, feeToOpenRate } = require("./shared/utilities")

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

const fixture = loadFixtureFromParams([{
    ...baseParams,
    halfLife: bn(HALF_LIFE),
    premiumRate: bn(1).shl(128).div(2)
}], {
    callback: async ({weth, usdc, derivable1155, derivablePools, stateCalHelper, utr, owner, accountA, accountB}) => {
        await attemptSwap(
            derivablePools[0],
            0,
            SIDE_R,
            SIDE_C,
            pe("9995"),
            0,
            stateCalHelper.address,
            utr.address,
            '0x0000000000000000000000000000000000000000',
            owner.address
        )
        // deploy TestHelper
        const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
        const derivableHelper = await DerivableHelper.deploy(
            derivablePools[0].address,
            derivable1155.address,
            stateCalHelper.address
        )
        await derivableHelper.deployed()
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
            derivableHelper
        }
    }
})

describe("DDL v3", function () {

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

    describe("Token", function () {
        it("isApprovedForAll", async function () {
            const { owner, derivable1155, accountA, utr } = await loadFixture(fixture)
            expect(await derivable1155.isApprovedForAll(owner.address, accountA.address)).equal(false)
            await derivable1155.setApprovalForAll(accountA.address, true)
            expect(await derivable1155.isApprovedForAll(owner.address, accountA.address)).equal(true)
            expect(await derivable1155.isApprovedForAll(owner.address, utr.address)).equal(true)
        })
        it("setDescriptorSetter", async function () {
            const { owner, derivable1155, accountA, accountB, utr } = await loadFixture(fixture)
            // deploy descriptor
            const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
            const tokenDescriptor = await TokenDescriptor.deploy()
            await tokenDescriptor.deployed()
            await expect(derivable1155.connect(accountA).setDescriptorSetter(accountB.address)).to.be.revertedWith("UNAUTHORIZED")
            await expect(derivable1155.connect(accountA).setDescriptor(tokenDescriptor.address)).to.be.revertedWith("UNAUTHORIZED")
            await derivable1155.setDescriptorSetter(accountA.address)
            await derivable1155.connect(accountA).setDescriptor(tokenDescriptor.address)
        })
        describe("ERC1155SupplyVirtual", function () {
            it("exists", async function () {
                const { derivable1155, derivablePools} = await loadFixture(fixture)
                expect(await derivable1155.exists(convertId(SIDE_A, derivablePools[0].address))).equal(true)
                expect(await derivable1155.exists(convertId(SIDE_B, derivablePools[0].address))).equal(true)
                expect(await derivable1155.exists(convertId(SIDE_C, derivablePools[0].address))).equal(true)
                expect(await derivable1155.exists(convertId(SIDE_R, derivablePools[0].address))).equal(false)
                expect(await derivable1155.exists(0)).equal(false)
            })
        })
    })

    describe("Pool", function () {
        async function testRIn(sideIn, amountIn, sideOut, isUseUTR) {
            const { owner, weth, derivablePools, utr, stateCalHelper } = await loadFixture(fixture)
            
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
                        amountIn: pe(amountIn),
                        recipient: derivablePools[0].address,
                    }],
                    code: derivablePools[0].address,
                    data: (await derivablePools[0].populateTransaction.swap(
                        {
                            sideIn,
                            sideOut,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, sideIn, sideOut, pe(amountIn)),
                        },
                        {
                            utr: utr.address,
                            payer,
                            recipient: owner.address
                        }
                    )).data,
                }], opts)
            }
            else {
                await derivablePools[0].swap(
                    {
                        sideIn,
                        sideOut,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, sideIn, sideOut, pe(amountIn)),
                    },
                    {
                        utr: utr.address,
                        payer,
                        recipient: owner.address,
                    },
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
            const { owner, weth, derivablePools, derivable1155, utr, stateCalHelper } = await loadFixture(fixture)
            const convertedId = convertId(sideIn, derivablePools[0].address)
            const payer = isUseUTR ? owner.address : AddressZero
            
            const tokenBefore = await derivable1155.balanceOf(owner.address, convertedId)
            if (isUseUTR) {
                await weth.approve(utr.address, MaxUint256)
                await utr.exec([], [{
                    inputs: [{
                        mode: PAYMENT,
                        eip: 1155,
                        token: derivable1155.address,
                        id: convertedId,
                        amountIn: pe(amountIn),
                        recipient: derivablePools[0].address,
                    }],
                    code: derivablePools[0].address,
                    data: (await derivablePools[0].populateTransaction.swap(
                        {
                            sideIn,
                            sideOut,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, sideIn, sideOut, pe(amountIn)),
                        },
                        {
                            utr: utr.address,
                            payer,
                            recipient: owner.address
                        }
                    )).data,
                }], opts)
            } else {
                await derivablePools[0].swap(
                    {
                        sideIn,
                        sideOut,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, sideIn, sideOut, pe(amountIn)),
                    },
                    {
                        utr: utr.address,
                        payer: AddressZero,
                        recipient: owner.address
                    },
                    opts
                )
            }
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertedId)
            const tokenChanged = tokenBefore.sub(tokenAfter)
            expect(tokenChanged).lte(pe(amountIn))
            expect(tokenChanged).gte(pe(amountIn).sub(1))
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
            const { owner, weth, derivablePools, utr, derivableHelper, stateCalHelper } = await loadFixture(fixture)
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
                            amountIn: pe(amount),
                            recipient: derivablePools[0].address,
                        }],
                        code: derivablePools[0].address,
                        data: (await derivablePools[0].populateTransaction.swap(
                            {
                                sideIn: SIDE_R,
                                sideOut: side,
                                maturity: 0,
                                helper: stateCalHelper.address,
                                payload: encodePayload(0, SIDE_R, side, pe(amount))
                            },
                            {
                                utr: utr.address,
                                payer: owner.address,
                                recipient: derivableHelper.address
                            }
                        )).data,
                    },
                    {
                        inputs: [],
                        code: derivableHelper.address,
                        data: (await derivableHelper.populateTransaction.swapInAll(
                            side,
                            SIDE_R,
                            0,
                            AddressZero,
                            owner.address,
                        )).data,
                    }
                ], opts)
            const after = await weth.balanceOf(owner.address)
            expect(before).gte(after)
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
            const { owner, weth, utr, uniswapPair, usdc, derivablePools, derivable1155, stateCalHelper } = await loadFixture(fixture)
            // swap weth -> long
            
            const wethBefore = await weth.balanceOf(owner.address)
            const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(isLong ? SIDE_A : SIDE_B, derivablePools[0].address))
            await derivablePools[0].swap(
                {
                    sideIn: SIDE_R,
                    sideOut: isLong ? SIDE_A : SIDE_B,
                    maturity: 0,
                    helper: stateCalHelper.address,
                    payload: encodePayload(0, SIDE_R, isLong ? SIDE_A : SIDE_B, pe(wethAmountIn)),
                },
                {
                    utr: utr.address,
                    payer: AddressZero,
                    recipient: owner.address,
                },
                opts
            )
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(isLong ? SIDE_A : SIDE_B, derivablePools[0].address))
            // change price
            await swapToSetPriceMock({
                baseToken: weth,
                quoteToken: usdc,
                uniswapPair,
                targetTwap: priceChange,
                targetSpot: priceChange
            })
            await time.increase(1000);
            // swap back long -> weth
            await derivablePools[0].swap(
                {
                    sideIn: isLong ? SIDE_A : SIDE_B,
                    sideOut: SIDE_R,
                    maturity: 0,
                    helper: stateCalHelper.address,
                    payload: encodePayload(0, isLong ? SIDE_A : SIDE_B, SIDE_R, tokenAfter.sub(tokenBefore)),
                },
                {
                    utr: utr.address,
                    payer: AddressZero,
                    recipient: owner.address,
                },
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
        describe("Price change drastically", function () {
            const MARK = 1500;
            const SAFE_SCALE = 8000000000;  // for k = 5
            const ZERO1 = MARK / SAFE_SCALE;
            const INFI1 = MARK * SAFE_SCALE;
            // TODO: can we support these?
            const ZERO2 = ZERO1; // / 1.1
            const INFI2 = INFI1; // * 1.1
    
            async function testSinglePositionPriceChangeDrastically(side, amountIn, priceChange, waitRecover) {
                const { owner, weth, utr, uniswapPair, usdc, derivablePools, derivable1155, stateCalHelper } = await loadFixture(fixture)
    
                const wethBefore = await weth.balanceOf(owner.address)
                const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(side, derivablePools[0].address))
                await derivablePools[0].swap(
                    {
                        sideIn: SIDE_R,
                        sideOut: side,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, SIDE_R, side, pe(amountIn), derivable1155.address),
                    },
                    {
                        utr: utr.address,
                        payer: AddressZero,
                        recipient: owner.address,
                    },
                    opts
                )
                const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(side, derivablePools[0].address))
    
                // change price
                await swapToSetPriceMock({
                    baseToken: weth,
                    quoteToken: usdc,
                    uniswapPair,
                    targetTwap: priceChange,
                    targetSpot: priceChange
                })
                await time.increase(1000);
                // price recover
                if (waitRecover) {
                    await swapToSetPriceMock({
                        baseToken: weth,
                        quoteToken: usdc,
                        uniswapPair,
                        targetTwap: 1500,
                        targetSpot: 1500
                    })
                    await time.increase(1000);
                }
    
                // swap back
                if ((
                    ((priceChange == ZERO2) && (side == SIDE_A)) ||
                    ((priceChange == INFI2) && (side == SIDE_B))
                ) &&
                    !waitRecover
                ) {
                    await expect(derivablePools[0].swap(
                        {
                            sideIn: side,
                            sideOut: SIDE_R,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, side, SIDE_R, tokenAfter.sub(tokenBefore), derivable1155.address),
                        },
                        {
                            utr: utr.address,
                            payer: AddressZero,
                            recipient: owner.address,
                        },
                        opts
                    ), `side(${side}) -> R`).to.be.reverted
                }
                else
                    await derivablePools[0].swap(
                        {
                            sideIn: side,
                            sideOut: SIDE_R,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, side, SIDE_R, tokenAfter.sub(tokenBefore), derivable1155.address),
                        },
                        {
                            utr: utr.address,
                            payer: AddressZero,
                            recipient: owner.address,
                        },
                        opts
                    )
            }
    
            async function testMultiPositonPriceChangeDrastically(longIn, shortIn, cIn, priceChange, waitRecover) {
                const { owner, weth, utr, uniswapPair, usdc, derivablePools, derivable1155, accountA, accountB, stateCalHelper } = await loadFixture(fixture)
    
                let txSignerA = await weth.connect(accountA)
                let txSignerB = await weth.connect(accountB)
                
                await txSignerA.approve(derivablePools[0].address, MaxUint256)
                await txSignerB.approve(derivablePools[0].address, MaxUint256)
    
                txSignerA = await derivablePools[0].connect(accountA)
                txSignerB = await derivablePools[0].connect(accountB)
    
                // swap eth -> long
                const aWethBefore = await weth.balanceOf(accountA.address)
                const longTokenBefore = await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePools[0].address))
                await txSignerA.swap(
                    {
                        sideIn: SIDE_R,
                        sideOut: SIDE_A,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, SIDE_R, SIDE_A, pe(longIn), derivable1155.address),
                    },
                    {
                        utr: utr.address,
                        payer: AddressZero,
                        recipient: accountA.address,
                    },
                    opts
                )
                const longTokenAfter = await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePools[0].address))
                // swap eth -> short
                const bWethBefore = await weth.balanceOf(accountB.address)
                const shortTokenBefore = await derivable1155.balanceOf(accountB.address, convertId(SIDE_B, derivablePools[0].address))
                await txSignerB.swap(
                    {
                        sideIn: SIDE_R,
                        sideOut: SIDE_B,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, SIDE_R, SIDE_B, pe(shortIn), derivable1155.address),
                    },
                    {
                        utr: utr.address,
                        payer: AddressZero,
                        recipient: accountB.address,
                    },
                    opts
                )
                const shortTokenAfter = await derivable1155.balanceOf(accountB.address, convertId(SIDE_B, derivablePools[0].address))
                // swap eth -> c
                const wethBefore = await weth.balanceOf(owner.address)
                const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(SIDE_C, derivablePools[0].address))
                await derivablePools[0].swap(
                    {
                        sideIn: SIDE_R,
                        sideOut: SIDE_C,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, SIDE_R, SIDE_C, pe(cIn), derivable1155.address),
                    },
                    {
                        utr: utr.address,
                        payer: AddressZero,
                        recipient: owner.address,
                    },
                    opts
                )
                const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(SIDE_C, derivablePools[0].address))
                // change price
                await swapToSetPriceMock({
                    baseToken: weth,
                    quoteToken: usdc,
                    uniswapPair,
                    targetTwap: priceChange,
                    targetSpot: priceChange
                })
                await time.increase(1000);
                // price recover
                if (waitRecover) {
                    await swapToSetPriceMock({
                        baseToken: weth,
                        quoteToken: usdc,
                        uniswapPair,
                        targetTwap: 1500,
                        targetSpot: 1500
                    })
                    await time.increase(1000);
                }
                // swap back long -> weth
                if ((priceChange == ZERO2) && (!waitRecover)) {
                    await expect(txSignerA.swap(
                        {
                            sideIn: SIDE_A,
                            sideOut: SIDE_R,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, SIDE_A, SIDE_R, longTokenAfter.sub(longTokenBefore), derivable1155.address),
                        },
                        {
                            utr: utr.address,
                            payer: AddressZero,
                            recipient: accountA.address,
                        },
                        opts
                    )).to.be.reverted
                } else {
                    await txSignerA.swap(
                        {
                            sideIn: SIDE_A,
                            sideOut: SIDE_R,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, SIDE_A, SIDE_R, longTokenAfter.sub(longTokenBefore), derivable1155.address),
                        },
                        {
                            utr: utr.address,
                            payer: AddressZero,
                            recipient: accountA.address,
                        },
                        opts
                    )
                }
                const aWethAfter = await weth.balanceOf(accountA.address)
                // swap back short -> weth
                if ((priceChange == INFI2) && (!waitRecover)) {
                    await expect(txSignerB.swap(
                        {
                            sideIn: SIDE_B,
                            sideOut: SIDE_R,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, SIDE_B, SIDE_R, shortTokenAfter.sub(shortTokenBefore), derivable1155.address),
                        },
                        {
                            utr: utr.address,
                            payer: AddressZero,
                            recipient: accountB.address,
                        },
                        opts
                    )).to.be.reverted
                }
                else {
                    await txSignerB.swap(
                        {
                            sideIn: SIDE_B,
                            sideOut: SIDE_R,
                            maturity: 0,
                            helper: stateCalHelper.address,
                            payload: encodePayload(0, SIDE_B, SIDE_R, shortTokenAfter.sub(shortTokenBefore), derivable1155.address),
                        },
                        {
                            utr: utr.address,
                            payer: AddressZero,
                            recipient: accountB.address,
                        },
                        opts
                    )
                }
                const bWethAfter = await weth.balanceOf(accountB.address)
                // swap back c -> weth
                await derivablePools[0].swap(
                    {
                        sideIn: SIDE_C,
                        sideOut: SIDE_R,
                        maturity: 0,
                        helper: stateCalHelper.address,
                        payload: encodePayload(0, SIDE_C, SIDE_R, tokenAfter.sub(tokenBefore), derivable1155.address),
                    },
                    {
                        utr: utr.address,
                        payer: AddressZero,
                        recipient: owner.address,
                    },
                    opts
                )
                
                const wethAfter = await weth.balanceOf(owner.address)
                const actual = Number(fe(wethAfter.sub(wethBefore)))
                // console.log(actual)
                // return expect(actual / expected).to.be.closeTo(1, 0.01)
            }
    
            describe("Single position", function () {
                it("Long 1e - price ~zero1 - wait price recover", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_A, 1, ZERO1, true)
                })
                it("Long 1e - price ~zero1", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_A, 1, ZERO1, false)
                })
                it("Short 1e - price ~zero1 - wait price recover", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_B, 1, ZERO1, true)
                })
                it("Short 1e - price ~zero1", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_B, 1, ZERO1, false)
                })
                it("C 1e - price ~zero1 - wait price recover", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_C, 1, ZERO1, true)
                })
                it("C 1e - price ~zero1", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_C, 1, ZERO1, false)
                })

                // TODO: Solve this later
                // it("Long 1e - price ~zero2 - wait price recover", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_A, 1, ZERO2, true)
                // })
                // it("Long 1e - price ~zero2", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_A, 1, ZERO2, false)
                // })
                // it("Short 1e - price ~zero2 - wait price recover", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_B, 1, ZERO2, true)
                // })
                // it("Short 1e - price ~zero2", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_B, 1, ZERO2, false)
                // })
                // it("C 1e - price ~zero2 - wait price recover", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_C, 1, ZERO2, true)
                // })
                // it("C 1e - price ~zero2", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_C, 1, ZERO2, false)
                // })
    
                it("Long 1e - price ~infi1 - wait price recover", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_A, 1, INFI1, true)
                })
                it("Long 1e - price ~infi1", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_A, 1, INFI1, false)
                })
                it("Short 1e - price ~infi1 - wait price recover", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_B, 1, INFI1, true)
                })
                it("Short 1e - price ~infi1", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_B, 1, INFI1, false)
                })
                it("C 1e - price ~infi1 - wait price recover", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_C, 1, INFI1, true)
                })
                it("C 1e - price ~infi1", async function () {
                    await testSinglePositionPriceChangeDrastically(SIDE_C, 1, INFI1, false)
                })
               
                // TODO: Solve this later
                // it("Long 1e - price ~infi2", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_A, 1, INFI2, false)
                // })
                // it("Short 1e - price ~infi2", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_B, 1, INFI2, false)
                // })
                // it("C 1e - price ~infi2", async function () {
                //     await testSinglePositionPriceChangeDrastically(SIDE_C, 1, INFI2, false)
                // })
            })
    
            describe("Multi position", function () {
                it("Long 1e - short 1e - c 1e - price ~zero1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 1, 1, ZERO1, true)
                })
                it("Long 0.1e - short 1e - c 0.1e - price ~zero1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, ZERO1, true)
                })
                it("Long 1e - short 0.1e - c 0.1e - price ~zero1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, ZERO1, true)
                })
                it("Long 0.1e - short 0.1e - c 100e - price ~zero1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, ZERO1, true)
                })
                it("Long 1e - short 1e - c 1e - price ~zero1", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 1, 1, ZERO1, false)
                })
                it("Long 0.1e - short 1e - c 0.1e - price ~zero1", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, ZERO1, false)
                })
                it("Long 1e - short 0.1e - c 0.1e - price ~zero1", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, ZERO1, false)
                })
                it("Long 0.1e - short 0.1e - c 100e - price ~zero1", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, ZERO1, false)
                })

                // TODO: Solve this later
                // it("Long 1e - short 1e - c 1e - price ~zero2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 1, 1, ZERO2, true)
                // })
                // it("Long 0.1e - short 1e - c 0.1e - price ~zero2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, ZERO2, true)
                // })
                // it("Long 1e - short 0.1e - c 0.1e - price ~zero2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, ZERO2, true)
                // })
                // it("Long 0.1e - short 0.1e - c 100e - price ~zero2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, ZERO2, true)
                // })
                // it("Long 1e - short 1e - c 1e - price ~zero2", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 1, 1, ZERO2, false)
                // })
                // it("Long 0.1e - short 1e - c 0.1e - price ~zero2", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, ZERO2, false)
                // })
                // it("Long 1e - short 0.1e - c 0.1e - price ~zero2", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, ZERO2, false)
                // })
                // it("Long 0.1e - short 0.1e - c 100e - price ~zero2", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, ZERO2, false)
                // })
    
                it("Long 1e - short 1e - c 1e - price ~infi1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 1, 1, INFI1, true)
                })
                it("Long 0.1e - short 1e - c 0.1e - price ~infi1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, INFI1, true)
                })
                it("Long 1e - short 0.1e - c 0.1e - price ~infi1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, INFI1, true)
                })
                it("Long 0.1e - short 0.1e - c 100e - price ~infi1 - wait price recover", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, INFI1, true)
                })
                it("Long 1e - short 1e - c 1e - price ~infi1", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 1, 1, INFI1, false)
                })
                it("Long 0.1e - short 1e - c 0.1e - price ~infi1", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, INFI1, false)
                })
                it("Long 1e - short 0.1e - c 0.1e - price ~infi1", async function () {
                    await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, INFI1, false)
                })
                it("Long 0.1e - short 0.1e - c 100e - price ~infi1", async function () {
                    await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, INFI1, false)
                })

                // TODO: Solve this later
                // it("Long 1e - short 1e - c 1e - price ~infi2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 1, 1, INFI2, true)
                // })
                // it("Long 0.1e - short 1e - c 0.1e - price ~infi2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, INFI2, true)
                // })
                // it("Long 1e - short 0.1e - c 0.1e - price ~infi2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, INFI2, true)
                // })
                // it("Long 0.1e - short 0.1e - c 100e - price ~infi2 - wait price recover", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, INFI2, true)
                // })
                // it("Long 1e - short 1e - c 1e - price ~infi2", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 1, 1, INFI2, false)
                // })
                // it("Long 0.1e - short 1e - c 0.1e - price ~infi2", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 1, 0.1, INFI2, false)
                // })
                // it("Long 1e - short 0.1e - c 0.1e - price ~infi2", async function () {
                //     await testMultiPositonPriceChangeDrastically(1, 0.1, 0.1, INFI2, false)
                // })
                // it("Long 0.1e - short 0.1e - c 100e - price ~infi2", async function () {
                //     await testMultiPositonPriceChangeDrastically(0.1, 0.1, 100, INFI2, false)
                // })
            })
        })
    })
})

