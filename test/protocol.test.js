const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, swapToSetPriceMock, packId, numberToWei } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const PAYMENT = 0;

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Protocol", function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        halfLife: bn(HALF_LIFE),
        premiumRate: bn(1).shl(128).div(2)
    }], {
        callback: async ({weth, usdc, derivable1155, stateCalHelper, owner, derivablePools, accountA, accountB}) => {
            const pool = derivablePools[0]
            await pool.swap(
                SIDE_R,
                SIDE_C,
                pe("9995"),
                {
                    recipient: owner.address
                }
            )
            // deploy TestHelper
            const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
            const derivableHelper = await DerivableHelper.deploy(
                pool.contract.address,
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
            const { derivable1155, accountA, accountB, poolFactory } = await loadFixture(fixture)
            // deploy descriptor
            const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
            const tokenDescriptor = await TokenDescriptor.deploy(poolFactory.address)
            await tokenDescriptor.deployed()
            await expect(derivable1155.connect(accountA).setDescriptorSetter(accountB.address)).to.be.revertedWith("UNAUTHORIZED")
            await expect(derivable1155.connect(accountA).setDescriptor(tokenDescriptor.address)).to.be.revertedWith("UNAUTHORIZED")
            await derivable1155.setDescriptorSetter(accountA.address)
            await derivable1155.connect(accountA).setDescriptor(tokenDescriptor.address)
        })
        describe("ERC1155SupplyVirtual", function () {
            it("exists", async function () {
                const { derivable1155, derivablePools} = await loadFixture(fixture)
                expect(await derivable1155.totalSupply(convertId(SIDE_A, derivablePools[0].contract.address))).gt(0)
                expect(await derivable1155.totalSupply(convertId(SIDE_B, derivablePools[0].contract.address))).gt(0)
                expect(await derivable1155.totalSupply(convertId(SIDE_C, derivablePools[0].contract.address))).gt(0)
                expect(await derivable1155.totalSupply(convertId(SIDE_R, derivablePools[0].contract.address))).equal(0)
                expect(await derivable1155.totalSupply(0)).equal(0)
            })
        })
    })

    describe("Pool", function () {
        it("Init pool by UTR", async function () {
            const { owner, weth, utr, params, poolFactory, derivable1155 } = await loadFixture(fixture)
            const config = {
                ORACLE: params[0].oracle,
                TOKEN_R: params[0].reserveToken,
                MARK: params[0].mark,
                K: bn(6),
                INTEREST_HL: params[0].halfLife,
                PREMIUM_RATE: params[0].premiumRate,
                MATURITY: params[0].maturity,
                MATURITY_VEST: params[0].maturityVest,
                MATURITY_RATE: params[0].maturityRate,
                OPEN_RATE: params[0].openRate,
            }
            const tx = await poolFactory.createPool(config)
            const receipt = await tx.wait()
            const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
            expect(await derivable1155.balanceOf(owner.address, convertId(SIDE_A, poolAddress))).equal(0)
            const initParams = {
                R: numberToWei(5),
                a: numberToWei(1),
                b: numberToWei(1),
            }
            const payment = {
                utr: utr.address,
                payer: owner.address,
                recipient: owner.address,
            }
            const pool = await ethers.getContractAt("PoolBase", poolAddress)
            await weth.approve(utr.address, MaxUint256);
            await utr.exec([],
            [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 20,
                    token: weth.address,
                    id: 0,
                    amountIn: numberToWei(5),
                    recipient: poolAddress,
                }],
                flags: 0,
                code: poolAddress,
                data: (await pool.populateTransaction.init(
                    initParams,
                    payment
                )).data,
            }])
            expect(await derivable1155.balanceOf(owner.address, convertId(SIDE_A, poolAddress))).gt(0)
        })

        async function testRIn(sideIn, amountIn, sideOut, isUseUTR) {
            const { owner, weth, derivablePools, utr } = await loadFixture(fixture)
            
            const payer = isUseUTR ? owner.address : AddressZero
            const wethBefore = await weth.balanceOf(owner.address)
            if (isUseUTR) {
                const pTx = await derivablePools[0].swap(
                    sideIn,
                    sideOut,
                    pe(amountIn),
                    {
                        payer,
                        populateTransaction: true
                    }
                )
                await weth.approve(utr.address, MaxUint256)
                await utr.exec([], [{
                    inputs: [{
                        mode: PAYMENT,
                        eip: 20,
                        token: weth.address,
                        id: 0,
                        amountIn: pe(amountIn),
                        recipient: derivablePools[0].contract.address,
                    }],
                    code: derivablePools[0].contract.address,
                    data: pTx.data,
                }], opts)
            }
            else {
                await derivablePools[0].swap(
                    sideIn,
                    sideOut,
                    pe(amountIn),
                    {
                        payer
                    }
                )
            }
            const wethAfter = await weth.balanceOf(owner.address)
            const wethChanged = wethBefore.sub(wethAfter)
            expect(wethChanged).equal(pe(amountIn))
        }
        it("weth -> lp: allowance", async function () {
            await testRIn(SIDE_R, "1", SIDE_C, false)
        })
        it("weth -> long: allowance", async function () {
            await testRIn(SIDE_R, "0.5", SIDE_A, false)
        })
        it("weth -> short: allowance", async function () {
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
            const { owner, weth, derivablePools, derivable1155, utr } = await loadFixture(fixture)
            const convertedId = convertId(sideIn, derivablePools[0].contract.address)
            const payer = isUseUTR ? owner.address : AddressZero
            
            const tokenBefore = await derivable1155.balanceOf(owner.address, convertedId)
            if (amountIn == null) {
                amountIn = tokenBefore
            } else {
                amountIn = pe(amountIn)
            }
            if (isUseUTR) {
                const pTx = await derivablePools[0].swap(
                    sideIn,
                    sideOut,
                    amountIn,
                    {
                        payer,
                        populateTransaction: true
                    }
                )
                await weth.approve(utr.address, MaxUint256)
                await utr.exec([], [{
                    inputs: [{
                        mode: PAYMENT,
                        eip: 1155,
                        token: derivable1155.address,
                        id: convertedId,
                        amountIn,
                        recipient: derivablePools[0].contract.address,
                    }],
                    code: derivablePools[0].contract.address,
                    data: pTx.data,
                }], opts)
            } else {
                await derivablePools[0].swap(
                    sideIn,
                    sideOut,
                    amountIn,
                    {
                        payer
                    }
                )
            }
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertedId)
            const tokenChanged = tokenBefore.sub(tokenAfter)
            expect(tokenChanged).lte(amountIn).gte(amountIn.sub(2))
        }
        it("all lp -> weth: allowance", async function () {
            await testROut(SIDE_C, null, SIDE_R, false)
        })
        it("all long -> weth: allowance", async function () {
            await testROut(SIDE_A, null, SIDE_R, false)
        })
        it("all short -> weth: allowance", async function () {
            await testROut(SIDE_B, null, SIDE_R, false)
        })
        it("lp -> weth: allowance", async function () {
            await testROut(SIDE_C, "1", SIDE_R, false)
        })
        it("long -> weth: allowance", async function () {
            await testROut(SIDE_A, "0.1", SIDE_R, false)
        })
        it("short -> weth: allowance", async function () {
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
            const { owner, weth, derivablePools, utr, derivableHelper } = await loadFixture(fixture)
            const before = await weth.balanceOf(owner.address)
            await weth.approve(utr.address, MaxUint256)
            const pTx = await derivablePools[0].swap(
                SIDE_R,
                side,
                pe(amount),
                {
                    populateTransaction: true,
                    recipient: derivableHelper.address,
                    payer: owner.address
                }
            )
            await utr.exec([],
                [
                    {
                        inputs: [{
                            mode: PAYMENT,
                            eip: 20,
                            token: weth.address,
                            id: 0,
                            amountIn: pe(amount),
                            recipient: derivablePools[0].contract.address,
                        }],
                        code: derivablePools[0].contract.address,
                        data: pTx.data,
                    },
                    {
                        inputs: [],
                        code: derivableHelper.address,
                        data: (await derivableHelper.populateTransaction.swapInAll(
                            side,
                            SIDE_R,
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

        async function testSupplyIn(side, amount, useUTR) {
            const {derivable1155, owner, utr, derivablePools} = await loadFixture(fixture)
            const pool = derivablePools[0]
            const idIn = packId(side, pool.contract.address)

            const supplyBefore = await derivable1155.totalSupply(idIn)
            const amountIn = numberToWei(amount)

            if (!useUTR) {
                await pool.swap(
                    side,
                    SIDE_R,
                    amountIn
                )
            } else {
                const data = (await pool.swap(
                    side,
                    SIDE_R,
                    amountIn, {
                        populateTransaction: true,
                        payer: owner.address
                    }
                )).data
                await utr.exec([], [
                    {
                        inputs: [{
                            mode: PAYMENT,
                            eip: 1155,
                            token: derivable1155.address,
                            id: idIn,
                            amountIn: amountIn,
                            recipient: pool.contract.address,
                        }],
                        code: pool.contract.address,
                        data: data,
                    }
                ])
            }
            const supplyAfter = await derivable1155.totalSupply(idIn)
            // console.log(supplyAfter.sub(supplyBefore.sub(amountIn)))
            expect(supplyAfter.sub(supplyBefore.sub(amountIn))).lte(1)
        }
        it("Supply after swap: A -> R - Non UTR", async function () {
            await testSupplyIn(SIDE_A, 0.1, false)
        })
        it("Supply after swap: B -> R - Non UTR", async function () {
            await testSupplyIn(SIDE_B, 0.1, false)
        })
        it("Supply after swap: C -> R - Non UTR", async function () {
            await testSupplyIn(SIDE_C, 0.1, false)
        })
        it("Supply after swap: A -> R - UTR", async function () {
            await testSupplyIn(SIDE_A, 0.1, true)
        })
        it("Supply after swap: B -> R - UTR", async function () {
            await testSupplyIn(SIDE_B, 0.1, true)
        })
        it("Supply after swap: C -> R - UTR", async function () {
            await testSupplyIn(SIDE_C, 0.1, true)
        })

        async function testPriceChange(isLong = true, wethAmountIn, priceChange, expected) {
            const { owner, weth, utr, uniswapPair, usdc, derivablePools, derivable1155, stateCalHelper } = await loadFixture(fixture)
            // swap weth -> long
            const wethBefore = await weth.balanceOf(owner.address)
            const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(isLong ? SIDE_A : SIDE_B, derivablePools[0].contract.address))
            await derivablePools[0].swap(
                SIDE_R,
                isLong ? SIDE_A : SIDE_B,
                pe(wethAmountIn),
                {
                    payer: AddressZero,
                    recipient: owner.address
                }
            )
            const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(isLong ? SIDE_A : SIDE_B, derivablePools[0].contract.address))
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
                isLong ? SIDE_A : SIDE_B,
                SIDE_R,
                tokenAfter.sub(tokenBefore),
                {
                    payer: AddressZero,
                    recipient: owner.address,
                }
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
                const { owner, weth, uniswapPair, usdc, derivablePools, derivable1155, stateCalHelper } = await loadFixture(fixture)
    
                const wethBefore = await weth.balanceOf(owner.address)
                const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(side, derivablePools[0].contract.address))
                await derivablePools[0].swap(
                    SIDE_R,
                    side,
                    pe(amountIn),
                    {
                        payer: AddressZero,
                        recipient: owner.address,
                    }
                )
                const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(side, derivablePools[0].contract.address))
    
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
                        side,
                        SIDE_R,
                        tokenAfter.sub(tokenBefore),
                        {
                            payer: AddressZero,
                            recipient: owner.address,
                        }
                    ), `side(${side}) -> R`).to.be.reverted
                }
                else
                    await derivablePools[0].swap(
                        side,
                        SIDE_R,
                        tokenAfter.sub(tokenBefore),
                        {
                            payer: AddressZero,
                            recipient: owner.address,
                        }
                    )
            }
    
            async function testMultiPositonPriceChangeDrastically(longIn, shortIn, cIn, priceChange, waitRecover) {
                const { owner, weth, uniswapPair, usdc, derivablePools, derivable1155, accountA, accountB, stateCalHelper } = await loadFixture(fixture)
    
                let txSignerA = await weth.connect(accountA)
                let txSignerB = await weth.connect(accountB)
                
                await txSignerA.approve(derivablePools[0].contract.address, MaxUint256)
                await txSignerB.approve(derivablePools[0].contract.address, MaxUint256)
    
                txSignerA = await derivablePools[0].connect(accountA)
                txSignerB = await derivablePools[0].connect(accountB)
    
                // swap eth -> long
                const aWethBefore = await weth.balanceOf(accountA.address)
                const longTokenBefore = await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePools[0].contract.address))
                await derivablePools[0].connect(accountA).swap(
                    SIDE_R,
                    SIDE_A,
                    pe(longIn),
                    {
                        payer: AddressZero,
                        recipient: accountA.address,
                    }
                )
                const longTokenAfter = await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePools[0].contract.address))
                // swap eth -> short
                const bWethBefore = await weth.balanceOf(accountB.address)
                const shortTokenBefore = await derivable1155.balanceOf(accountB.address, convertId(SIDE_B, derivablePools[0].contract.address))
                await derivablePools[0].connect(accountB).swap(
                    SIDE_R,
                    SIDE_B,
                    pe(shortIn),
                    {
                        payer: AddressZero,
                        recipient: accountB.address,
                    }
                )
                const shortTokenAfter = await derivable1155.balanceOf(accountB.address, convertId(SIDE_B, derivablePools[0].contract.address))
                // swap eth -> c
                const wethBefore = await weth.balanceOf(owner.address)
                const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(SIDE_C, derivablePools[0].contract.address))
                await derivablePools[0].swap(
                    SIDE_R,
                    SIDE_C,
                    pe(cIn),
                    {
                        payer: AddressZero,
                        recipient: owner.address,
                    }
                )
                const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(SIDE_C, derivablePools[0].contract.address))
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
                    await expect(derivablePools[0].connect(accountA).swap(
                        SIDE_A,
                        SIDE_R,
                        longTokenAfter.sub(longTokenBefore),
                        {
                            payer: AddressZero,
                            recipient: accountA.address,
                        }
                    )).to.be.reverted
                } else {
                    await derivablePools[0].connect(accountA).swap(
                        SIDE_A,
                        SIDE_R,
                        longTokenAfter.sub(longTokenBefore),
                        {
                            payer: AddressZero,
                            recipient: accountA.address,
                        }
                    )
                }
                const aWethAfter = await weth.balanceOf(accountA.address)
                // swap back short -> weth
                if ((priceChange == INFI2) && (!waitRecover)) {
                    await expect(derivablePools[0].connect(accountB).swap(
                        SIDE_B,
                        SIDE_R,
                        shortTokenAfter.sub(shortTokenBefore),
                        {
                            payer: AddressZero,
                            recipient: accountB.address,
                        }
                    )).to.be.reverted
                }
                else {
                    await derivablePools[0].connect(accountB).swap(
                        SIDE_B,
                        SIDE_R,
                        shortTokenAfter.sub(shortTokenBefore),
                        {
                            payer: AddressZero,
                            recipient: accountB.address,
                        }
                    )
                }
                const bWethAfter = await weth.balanceOf(accountB.address)
                // swap back c -> weth
                await derivablePools[0].swap(
                    SIDE_C,
                    SIDE_R,
                    tokenAfter.sub(tokenBefore),
                    {
                        payer: AddressZero,
                        recipient: owner.address,
                    }
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

