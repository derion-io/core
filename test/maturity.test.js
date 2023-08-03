const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { weiToNumber, numberToWei, bn, packId } = require("./shared/utilities")
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant")
const { expect } = require("chai")

const configs = [
{
    exp: 0.9,
    coef: 1
}, 
{
    exp: 1,
    coef: 1
}, 
{
    exp: 8,
    coef: 1
}, 
{
    exp: 8,
    coef: 0
}, 
{
    exp: 8,
    coef: 0.9
}
]

configs.forEach(config => describe(`Maturity - EXP = ${config.exp}, COEF ${config.coef}`, function () {
    const {exp, coef} = config
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        maturity: 60,
        maturityVest: Math.floor(60 / exp),
        maturityRate: bn(coef*1000).shl(128).div(1000),
    }, baseParams], {})

    async function beneficiarySideFromPayOff(fromSide, toSide) {
        const {accountA, accountB, derivablePools, stateCalHelper, owner} = await loadFixture(fixture)
        const sides = [SIDE_A, SIDE_B, SIDE_C]
        const index = sides.indexOf(toSide)
        const pool = derivablePools[0]
        sides.splice(index, 1)

        await time.increase(60)

        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            {
                recipient: accountA.address
            }
        )

        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(1),
            {
                recipient: accountA.address
            }
        )

        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1),
            {
                recipient: accountA.address
            }
        )

        const valuesBefore = await Promise.all(sides.map(async side => {
            return await pool.swap(
                side,
                SIDE_R,
                numberToWei(0.1),
                { static: true }
            )
        }))

        const toSideValueBefore = await pool.swap(
            toSide,
            SIDE_R,
            numberToWei(0.1),
            { 
                static: true,
                recipient: accountB.address
            }
        )

        await pool.connect(accountA).swap(
            fromSide,
            toSide,
            numberToWei(0.1),
            { 
                recipient: accountB.address
            }
        )

        const valuesAfter = await Promise.all(sides.map(async side => {
            return await pool.swap(
                side,
                SIDE_R,
                numberToWei(0.1),
                { static: true }
            )
        }))

        const toSideValueAfter = await pool.swap(
            toSide,
            SIDE_R,
            numberToWei(0.1),
            { static: true }
        )

        sides.forEach((side, index) => {
            expect(Number(weiToNumber(valuesBefore[index]))/Number(weiToNumber(valuesAfter[index]))).to.be.closeTo(1, 1e17)
        })
        expect(toSideValueBefore).to.be.lt(toSideValueAfter)
    }

    async function closePositionPayOff(side, t) {
        const {accountA, derivablePools, stateCalHelper} = await loadFixture(fixture)
        const derivablePool = derivablePools[0]
        const poolNoMaturity = derivablePools[1]

        await derivablePool.swap(
            SIDE_R,
            side,
            numberToWei(1),
            { 
                recipient: accountA.address
            }
        )
        const curTime = await time.latest()
        await poolNoMaturity.swap(
            SIDE_R,
            side,
            numberToWei(1),
            { 
                recipient: accountA.address
            }
        )
        await time.increaseTo(curTime + 60 - t)

        const amountOutNoMaturity = await poolNoMaturity.connect(accountA).swap(
            side,
            SIDE_R,
            numberToWei(1),
            { 
                static: true
            }
        )

        const amountOut = await derivablePool.connect(accountA).swap(
            side,
            SIDE_R,
            numberToWei(1),
            { 
                static: true
            }
        )

        if (t <= 0) {
            expect(amountOut).to.be.eq(amountOutNoMaturity)
        }
        else {
            const vesting_maturity = Math.floor(60 / exp)
            const elapse = 60 - t;
            if (elapse < vesting_maturity) {
                expect(Number(weiToNumber(amountOut))/Number(weiToNumber(amountOutNoMaturity)))
                .to.be.closeTo(coef * elapse/vesting_maturity, 1e-10)
            } else {
                expect(Number(weiToNumber(amountOut))/Number(weiToNumber(amountOutNoMaturity)))
                .to.be.closeTo(coef, 1e-10)
            }
            
        }
    }

    async function closePositionPartAndFull(side, t) {
        const {accountA, accountB, derivablePools, derivable1155} = await loadFixture(fixture)
        const derivablePool = derivablePools[0]
        const poolNoMaturity = derivablePools[1]

        const curTime = await time.latest()
        await derivablePool.swap(
            SIDE_R,
            side,
            numberToWei(0.5),
            curTime + 120,
            { 
                recipient: accountA.address
            }
        )

        await poolNoMaturity.swap(
            SIDE_R,
            side,
            numberToWei(0.5),
            0,
            { 
                recipient: accountA.address
            }
        )
        await time.setNextBlockTimestamp(curTime + 120 - t)

        const tokenBalance = await derivable1155.balanceOf(accountA.address, packId(side, derivablePool.contract.address))
        const transferOut = (coef === 0.9 && exp === 8 && side === SIDE_A) ? 2 : 1
        await derivable1155.connect(accountA).safeTransferFrom(
            accountA.address,
            accountB.address,
            packId(side, derivablePool.contract.address),
            transferOut,
            0x0
        )

        const amountOutNoMaturityPart = await poolNoMaturity.connect(accountA).swap(
            side,
            SIDE_R,
            2000000000000,
            0,
            { 
                static: true
            }
        )

        const amountOutPart = await derivablePool.connect(accountA).swap(
            side,
            SIDE_R,
            2000000000000,
            0,
            { 
                static: true
            }
        )
        
        const amountOutNoMaturityFull = await poolNoMaturity.connect(accountA).swap(
            side,
            SIDE_R,
            await derivable1155.balanceOf(accountA.address, packId(side, poolNoMaturity.contract.address)),
            0,
            { 
                static: true
            }
        )

        const {amountOut: amountOutFull, amountIn: amountInFull} = await derivablePool.connect(accountA).swap(
            side,
            SIDE_R,
            tokenBalance,
            0,
            { 
                static: true,
                keepBoth: true
            }
        )

        const partRatio = Number(weiToNumber(amountOutPart)) / Number(weiToNumber(amountOutNoMaturityPart))
        const fullRatio = Number(weiToNumber(amountOutFull)) / Number(weiToNumber(amountOutNoMaturityFull)) 

        expect(partRatio).closeTo(fullRatio, 1e-10)
    } 

    // it('User should get amountOut = 0 if t < maturity', async function () {
    //     const {accountA, derivablePools} = await loadFixture(fixture)
    //     const derivablePool = derivablePools[0]

    //     await derivablePool.swap(
    //         SIDE_R,
    //         SIDE_A,
    //         numberToWei(1),
    //         {
    //             recipient: accountA.address
    //         }
    //     )

    //     await time.increase(45)

    //     const amountOut = await derivablePool.connect(accountA).swap(
    //         SIDE_A,
    //         SIDE_R,
    //         numberToWei(1),
    //         {
    //             static: true
    //         }
    //     )

    //     expect(amountOut).to.be.eq(0)
    // })

    it('User should not be able to open more Long directly', async function () {
        const {accountA, derivablePools, derivable1155} = await loadFixture(fixture)
        const derivablePool = derivablePools[0].connect(accountA)

        await derivablePool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(1),
        )

        const tokenAmount = await derivable1155.balanceOf(accountA.address, packId(SIDE_A, derivablePool.contract.address))
        expect(tokenAmount).gte(0)
        await time.increase(10)

        await expect(derivablePool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(1),
        )).revertedWith('Maturity: locktime order')
    })

    it('User should not be able to open more Short directly', async function () {
        const {accountA, derivablePools, derivable1155} = await loadFixture(fixture)
        const derivablePool = derivablePools[0].connect(accountA)

        await derivablePool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(1),
        )

        const tokenAmount = await derivable1155.balanceOf(accountA.address, packId(SIDE_B, derivablePool.contract.address))
        expect(tokenAmount).gte(0)
        await time.increase(10)

        await expect(derivablePool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(1),
        )).revertedWith('Maturity: locktime order')
    })

    it('User should not be able to provide more LP directly', async function () {
        const {accountA, derivablePools, derivable1155} = await loadFixture(fixture)
        const derivablePool = derivablePools[0].connect(accountA)

        await derivablePool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1),
        )

        const tokenAmount = await derivable1155.balanceOf(accountA.address, packId(SIDE_A, derivablePool.contract.address))
        expect(tokenAmount).gte(0)
        await time.increase(10)

        await expect(derivablePool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1),
        )).revertedWith('Maturity: locktime order')
    })

    if (exp !== 8 || coef !== 1)
        it ('Maturity payoff should be apply when close all long position', async function() {
            await closePositionPartAndFull(SIDE_A, 40)
        })

    if (exp !== 8 || coef !== 1)
        it ('Maturity payoff should be apply when close all short position', async function() {
            await closePositionPartAndFull(SIDE_B, 40)
        })

    it('User should get amountOut > 0 if t > maturity, T - t = 40, buy Long', async function () {
        await closePositionPayOff(SIDE_A, 40)
    })

    it('User should get amountOut > 0 if t > maturity, T - t = 20, buy Long', async function () {
        await closePositionPayOff(SIDE_A, 20)
    })

    it('User should get amountOut > 0 if t > maturity, T - t = 10, buy Long', async function () {
        await closePositionPayOff(SIDE_A, 1)
    })

    it('User should get amountOut > 0 if t > maturity, T - t = 40, buy Short', async function () {
        await closePositionPayOff(SIDE_B, 40)
    })

    it('User should get amountOut > 0 if t > maturity, T - t = 20, buy Short', async function () {
        await closePositionPayOff(SIDE_B, 20)
    })

    it('User should get amountOut > 0 if t > maturity, T - t = 10, buy Short', async function () {
        await closePositionPayOff(SIDE_B, 1)
    })

    it('User should get full amount if T - t > MATURITY, buy Long', async function () {
        await closePositionPayOff(SIDE_A, -1)
    })

    it('User should get full amount if T - t > MATURITY, buy Short', async function () {
        await closePositionPayOff(SIDE_B, -1)
    })

    it('User should get full amount if T - t = MATURITY, buy Long', async function () {
        await closePositionPayOff(SIDE_A, 0)
    })

    it('User should get full amount if T - t = MATURITY, buy Short', async function () {
        await closePositionPayOff(SIDE_B, 0)
    })

    describe("Beneficiary Side", function () {
        it("Side A's value should be increased, after B->A payoff", async function () {
            await beneficiarySideFromPayOff(SIDE_B, SIDE_A)
        })
    
        it("Side B's value should be increased, after A->B payoff", async function () {
            await beneficiarySideFromPayOff(SIDE_A, SIDE_B)
        })
    
        it("Side C's value should be increased, after B->C payoff", async function () {
            await beneficiarySideFromPayOff(SIDE_B, SIDE_C)
        })
    
        it("Side C's value should be increased, after A->C payoff", async function () {
            await beneficiarySideFromPayOff(SIDE_A, SIDE_C)
        })
    })
}))