const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A, SIDE_C, SIDE_B } = require("./shared/constant")
const { numberToWei, bn, weiToNumber } = require("./shared/utilities")
const { MaxUint256 } = require("@ethersproject/constants")
const { expect } = require("chai")

const PAYMENT       = 0;
const SECONDS_PER_DAY = 86400

function toHalfLife(dailyRate) {
    return Math.round(dailyRate == 0 ? 0 : SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate)))
}

const DAILY_INTEREST = 0.03
const DAILY_PREMIUM = 0.1

const UNIT = 10000

describe("Premium", function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        halfLife: bn(0),
        premiumHL: bn(toHalfLife(DAILY_PREMIUM)),
        mark: bn('13179171373343029902768196957842336318319')
    },
    {
        ...baseParams,
        halfLife: bn(toHalfLife(DAILY_INTEREST)),
        premiumHL: bn(toHalfLife(DAILY_PREMIUM)),
        mark: bn('13179171373343029902768196957842336318319')
    }], {
        logicName: 'View',
        initReserved: 3,
        feeRate: 0
    })

    async function compare(pool, derivable1155, dailyInterest = 0) {
        let {rA, rB, rC, state} = await pool.contract.compute(derivable1155.address)
        await time.increase(SECONDS_PER_DAY)
        await pool.swap(SIDE_R, SIDE_C, 1)
        const {rA: rA1, rB: rB1, rC: rC1, state: state1} = await pool.contract.compute(derivable1155.address)

        if (dailyInterest > 0) {
            rA = rA.sub(rA.mul(UNIT*dailyInterest).div(UNIT))
            rB = rB.sub(rB.mul(UNIT*dailyInterest).div(UNIT))
            rC = state.R.sub(rA).sub(rB)
        }

        let premium = rA.gt(rB) ? rA.sub(rB).mul(rA) : rB.sub(rA).mul(rB)
        premium = premium.abs().mul(UNIT*DAILY_PREMIUM).div(UNIT).div(state.R)

        let premiumAExpected
        let premiumBExpected
        let premiumCExpected

        if (rA.gt(rB)) {
            premiumAExpected = bn(0).sub(premium)
            premiumBExpected = premium.mul(rB).div(rB.add(rC))
            premiumCExpected = premium.mul(rC).div(rB.add(rC))
        } else {
            premiumBExpected = bn(0).sub(premium)
            premiumAExpected = premium.mul(rA).div(rA.add(rC))
            premiumCExpected = premium.mul(rC).div(rA.add(rC))
        }
        
        const premiumA = rA1.sub(rA)
        const premiumB = rB1.sub(rB)
        const premiumC = rC1.sub(rC)

        expect(premiumA.sub(premiumAExpected).abs(), 'premium A').lte(premiumA.abs().div(UNIT))
        expect(premiumB.sub(premiumBExpected).abs(), 'premium B').lte(premiumB.abs().div(UNIT))
        expect(premiumC.sub(premiumCExpected).abs(), 'premium C').lte(premiumC.abs().div(UNIT))
    }

    async function compareWithInterest(pool, derivable1155) {
        const {rA, rB, rC, state} = await pool.contract.compute(derivable1155.address)
        const rANum = Number(weiToNumber(rA))
        const rBNum = Number(weiToNumber(rB))
        const rCNum = Number(weiToNumber(rC))
        const RNum = Number(weiToNumber(state.R))
        await time.increase(SECONDS_PER_DAY)

        const rADecayed = rANum * (1 - DAILY_INTEREST)
        const rBDecayed = rBNum * (1 - DAILY_INTEREST)
        const rCDecayed = rCNum + (rANum + rBNum) * DAILY_INTEREST

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )

        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.compute(derivable1155.address)
        const rA1Num = Number(weiToNumber(rA1))
        const rB1Num = Number(weiToNumber(rB1))
        const rC1Num = Number(weiToNumber(rC1))

        let expectedRA1Num
        let expectedRB1Num
        let expectedRC1Num

        if (rADecayed > rBDecayed) {
            const expectedPremium = (rADecayed - rBDecayed) * DAILY_PREMIUM * rADecayed / RNum
            expectedRA1Num = rADecayed - expectedPremium
            expectedRB1Num = rBDecayed + expectedPremium * rBDecayed/(rBDecayed + rCDecayed)
            expectedRC1Num = rCDecayed + expectedPremium * rCDecayed/(rBDecayed + rCDecayed)
        } else {
            const expectedPremium = (rBDecayed - rADecayed) * DAILY_PREMIUM * rBDecayed / RNum
            expectedRB1Num = rBDecayed - expectedPremium
            expectedRA1Num = rADecayed + expectedPremium * rADecayed/(rADecayed + rCDecayed)
            expectedRC1Num = rCDecayed + expectedPremium * rCDecayed/(rADecayed + rCDecayed)
        }
        
        expect(rA1Num).to.be.closeTo(expectedRA1Num, 1e-5)
        expect(rB1Num).to.be.closeTo(expectedRB1Num, 1e-5)
        expect(rC1Num).to.be.closeTo(expectedRC1Num, 1e-5)
    }

    it("Apply premium: Long", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[0]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(2)
        )
        
        await compare(pool, derivable1155)
    })

    it("Apply interest and premium: Long - Interest 4%", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[1]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(2)
        )
        
        await compareWithInterest(pool, derivable1155)
    })

    it("Apply premium continuos: After a year - Long", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[0]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(2)
        )

        await time.increase(SECONDS_PER_DAY * 365)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
        await compare(pool, derivable1155)
    })

    it("Apply interest and premium continuous: After a year - Long - Interest 4%", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[1]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(2)
        )

        await time.increase(SECONDS_PER_DAY * 365)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
        await compareWithInterest(pool, derivable1155)
    })

    it("Apply premium: Short", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[0]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(2)
        )
        
        await compare(pool, derivable1155)
    })

    it("Apply interest and premium: Short - Interest 4%", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[1]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(2)
        )
        
        await compareWithInterest(pool, derivable1155)
    })

    it("Apply premium continuos: After a year - Short", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[0]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(2)
        )

        await time.increase(SECONDS_PER_DAY * 365)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
        await compare(pool, derivable1155)
    })

    it("Apply interest and premium continuous: After a year - Short - Interest 4%", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[1]
        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(2)
        )

        await time.increase(SECONDS_PER_DAY * 365)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
       await compareWithInterest(pool, derivable1155)
    })
})