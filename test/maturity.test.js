const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { attemptSwap, weiToNumber, numberToWei, attemptStaticSwap, bn } = require("./shared/utilities")
const { SIDE_R, SIDE_A, SIDE_B, Q64 } = require("./shared/constant")
const { AddressZero } = require("@ethersproject/constants")
const { expect } = require("chai")

const exps = [0.9, 1, 8]

exps.forEach(exp => describe(`Maturity - EXP = ${exp}`, function () {
    const coef = 1
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        maturity: 60,
        maturityExp: bn(exp*1000).shl(64).div(1000),
        maturityCoef: bn(coef*1000).shl(64).div(1000),
    }, baseParams], {})

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
            .to.be.closeTo(1-2**(exp*(t/60-1)), 1e-10)
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
}))