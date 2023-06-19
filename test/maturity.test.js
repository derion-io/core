const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { attemptSwap, weiToNumber, numberToWei, attemptStaticSwap, bn } = require("./shared/utilities")
const { SIDE_R, SIDE_A, SIDE_B, Q64, SIDE_C } = require("./shared/constant")
const { AddressZero } = require("@ethersproject/constants")
const { expect } = require("chai")

const configs = [
{
    exp: 0.9,
    coef: 1
}, {
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
}, {
    exp: 8,
    coef: 0.9
}
]

configs.forEach(config => describe(`Maturity - EXP = ${config.exp}, COEF ${config.coef}`, function () {
    const {exp, coef} = config
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        maturity: 0,
        maturityExp: bn(exp*1000).shl(64).div(1000),
        maturityCoef: bn(coef*1000).shl(64).div(1000),
    }, baseParams], {})

    async function beneficiarySideFromPayOff(fromSide, toSide) {
        const {accountA, accountB, derivablePools, stateCalHelper, owner} = await loadFixture(fixture)
        const sides = [SIDE_A, SIDE_B, SIDE_C]
        const index = sides.indexOf(toSide)
        const derivablePool = derivablePools[0]
        sides.splice(index, 1)

        await time.increase(60)

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            120
        )

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            SIDE_B,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            120
        )

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            SIDE_C,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            120
        )

        const valuesBefore = await Promise.all(sides.map(async side => {
            return await attemptStaticSwap(
                derivablePool,
                0,
                side,
                SIDE_R,
                numberToWei(0.1),
                stateCalHelper.address,
                AddressZero,
                owner.address,
                0
            )
        }))

        const toSideValueBefore = await attemptStaticSwap(
            derivablePool,
            0,
            toSide,
            SIDE_R,
            numberToWei(0.1),
            stateCalHelper.address,
            AddressZero,
            accountB.address,
            60
        )

        await attemptSwap(
            derivablePool.connect(accountA),
            0,
            fromSide,
            toSide,
            numberToWei(0.1),
            stateCalHelper.address,
            AddressZero,
            accountB.address,
            60
        )

        const valuesAfter = await Promise.all(sides.map(async side => {
            return await attemptStaticSwap(
                derivablePool,
                0,
                side,
                SIDE_R,
                numberToWei(0.1),
                stateCalHelper.address,
                AddressZero,
                owner.address,
                0
            )
        }))

        const toSideValueAfter = await attemptStaticSwap(
            derivablePool,
            0,
            toSide,
            SIDE_R,
            numberToWei(0.1),
            stateCalHelper.address,
            AddressZero,
            owner.address,
            120
        )

        sides.forEach((side, index) => {
            console.log(`side ${side} - value before ${valuesBefore[index]} - value after ${valuesAfter[index]}`)
        })
        console.log(`to side ${toSide} - value before ${toSideValueBefore} - value after ${toSideValueAfter}`)
    }

    async function closePositionPayOff(side, t) {
        const {accountA, derivablePools, stateCalHelper} = await loadFixture(fixture)
        const derivablePool = derivablePools[0]
        const poolNoMaturity = derivablePools[1]

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            side,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            120
        )

        await attemptSwap(
            poolNoMaturity,
            0,
            SIDE_R,
            side,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            0
        )
        await time.increase(119 - t)

        const amountOut = await attemptStaticSwap(
            derivablePool.connect(accountA),
            0,
            side,
            SIDE_R,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            0
        )

        const amountOutNoMaturity = await attemptStaticSwap(
            poolNoMaturity.connect(accountA),
            0,
            side,
            SIDE_R,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            0
        )

        if (t <= 0)
            expect(amountOut).to.be.eq(amountOutNoMaturity)
        else
            expect(Number(weiToNumber(amountOut))/Number(weiToNumber(amountOutNoMaturity)))
            .to.be.closeTo(coef*(1-2**(exp*(t/60-1))), 1e-10)
    }

    it('User should get amountOut = 0 if t < maturity', async function () {
        const {accountA, derivablePools, stateCalHelper} = await loadFixture(fixture)
        const derivablePool = derivablePools[0]

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            120
        )

        await time.increase(45)

        const amountOut = await attemptStaticSwap(
            derivablePool.connect(accountA),
            0,
            SIDE_A,
            SIDE_R,
            numberToWei(1),
            stateCalHelper.address,
            AddressZero,
            accountA.address,
            60
        )
        expect(amountOut).to.be.eq(0)
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
            console.log("\nSide A's value should be increased, after B->A payoff\n")
            await beneficiarySideFromPayOff(SIDE_B, SIDE_A)
        })
    
        it("Side B's value should be increased, after A->B payoff", async function () {
            console.log("\nSide B's value should be increased, after A->B payoff\n")
            await beneficiarySideFromPayOff(SIDE_A, SIDE_B)
        })
    
        it("Side C's value should be increased, after B->C payoff", async function () {
            console.log("\nSide C's value should be increased, after B->C payoff\n")
            await beneficiarySideFromPayOff(SIDE_B, SIDE_C)
        })
    
        it("Side C's value should be increased, after A->C payoff", async function () {
            console.log("\nSide C's value should be increased, after A->C payoff\n")
            await beneficiarySideFromPayOff(SIDE_A, SIDE_C)
        })
    })
}))