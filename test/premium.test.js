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

const DAILY_RATE = 0.04
const PREMIUM_RATE = 0.01

describe("Premium", function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        halfLife: bn(0),
        mark: bn('13179171373343029902768196957842336318319')
    },
    {
        ...baseParams,
        halfLife: bn(toHalfLife(DAILY_RATE)),
        mark: bn('13179171373343029902768196957842336318319')
    }], {
        logicName: 'View',
        initReserved: 3,
        feeRate: 0
    })

    it("Apply interest and premium: Long - Interest 0", async function () {
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
        
        const {rA, rB, rC} = await pool.contract.compute(derivable1155.address)
        const rANum = Number(weiToNumber(rA))
        const rBNum = Number(weiToNumber(rB))
        const rCNum = Number(weiToNumber(rC))
        await time.increase(SECONDS_PER_DAY)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.compute(derivable1155.address)
        const rA1Num = Number(weiToNumber(rA1))
        const rB1Num = Number(weiToNumber(rB1))
        const rC1Num = Number(weiToNumber(rC1))

        const expectedPremium = (rANum - rBNum) * PREMIUM_RATE
        const expectedRA1Num = rANum - expectedPremium
        const expectedRB1Num = rBNum + expectedPremium * rBNum/(rBNum + rCNum)
        const expectedRC1Num = rCNum + expectedPremium * rCNum/(rBNum + rCNum)
        expect(rA1Num).to.be.closeTo(expectedRA1Num, 1e-5)
        expect(rB1Num).to.be.closeTo(expectedRB1Num, 1e-5)
        expect(rC1Num).to.be.closeTo(expectedRC1Num, 1e-5)
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
        
        const {rA, rB, rC} = await pool.contract.compute(derivable1155.address)
        const rANum = Number(weiToNumber(rA))
        const rBNum = Number(weiToNumber(rB))
        const rCNum = Number(weiToNumber(rC))
        await time.increase(SECONDS_PER_DAY)

        const rADecayed = rANum * (1 - DAILY_RATE)
        const rBDecayed = rBNum * (1 - DAILY_RATE)
        const rCDecayed = rCNum + (rANum + rBNum) * DAILY_RATE

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )

        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.compute(derivable1155.address)
        const rA1Num = Number(weiToNumber(rA1))
        const rB1Num = Number(weiToNumber(rB1))
        const rC1Num = Number(weiToNumber(rC1))

        const expectedPremium = (rADecayed - rBDecayed) * PREMIUM_RATE
        const expectedRA1Num = rADecayed - expectedPremium
        const expectedRB1Num = rBDecayed + expectedPremium * rBDecayed/(rBDecayed + rCDecayed)
        const expectedRC1Num = rCDecayed + expectedPremium * rCDecayed/(rBDecayed + rCDecayed)
        expect(rA1Num).to.be.closeTo(expectedRA1Num, 1e-5)
        expect(rB1Num).to.be.closeTo(expectedRB1Num, 1e-5)
        expect(rC1Num).to.be.closeTo(expectedRC1Num, 1e-5)
    })

    it("Apply interest and premium: Short - Interest 0", async function () {
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
        
        const {rA, rB, rC} = await pool.contract.compute(derivable1155.address)
        const rANum = Number(weiToNumber(rA))
        const rBNum = Number(weiToNumber(rB))
        const rCNum = Number(weiToNumber(rC))
        await time.increase(SECONDS_PER_DAY)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.compute(derivable1155.address)
        const rA1Num = Number(weiToNumber(rA1))
        const rB1Num = Number(weiToNumber(rB1))
        const rC1Num = Number(weiToNumber(rC1))

        const expectedPremium = (rBNum - rANum) * PREMIUM_RATE
        const expectedRA1Num = rANum + expectedPremium * rANum/(rANum + rCNum)
        const expectedRB1Num = rBNum - expectedPremium
        const expectedRC1Num = rCNum + expectedPremium * rCNum/(rANum + rCNum)
        expect(rA1Num).to.be.closeTo(expectedRA1Num, 1e-5)
        expect(rB1Num).to.be.closeTo(expectedRB1Num, 1e-5)
        expect(rC1Num).to.be.closeTo(expectedRC1Num, 1e-5)
    })

    it("Apply interest and premium: Shhort - Interest 4%", async function () {
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
        
        const {rA, rB, rC} = await pool.contract.compute(derivable1155.address)
        const rANum = Number(weiToNumber(rA))
        const rBNum = Number(weiToNumber(rB))
        const rCNum = Number(weiToNumber(rC))
        await time.increase(SECONDS_PER_DAY)

        const rADecayed = rANum * (1 - DAILY_RATE)
        const rBDecayed = rBNum * (1 - DAILY_RATE)
        const rCDecayed = rCNum + (rANum + rBNum) * DAILY_RATE

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )

        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.compute(derivable1155.address)
        const rA1Num = Number(weiToNumber(rA1))
        const rB1Num = Number(weiToNumber(rB1))
        const rC1Num = Number(weiToNumber(rC1))

        const expectedPremium = (rBDecayed - rADecayed) * PREMIUM_RATE
        const expectedRA1Num = rADecayed + expectedPremium * rADecayed/(rADecayed + rCDecayed)
        const expectedRB1Num = rBDecayed - expectedPremium
        const expectedRC1Num = rCDecayed + expectedPremium * rCDecayed/(rADecayed + rCDecayed)
        expect(rA1Num).to.be.closeTo(expectedRA1Num, 1e-5)
        expect(rB1Num).to.be.closeTo(expectedRB1Num, 1e-5)
        expect(rC1Num).to.be.closeTo(expectedRC1Num, 1e-5)
    })
})