const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A, SIDE_C, SIDE_B } = require("./shared/constant")
const { numberToWei, bn, packId } = require("./shared/utilities")
const { expect } = require("chai")

const PAYMENT       = 0;
const SECONDS_PER_DAY = 86400

function toHalfLife(dailyRate) {
    return Math.round(dailyRate == 0 ? 0 : SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate)))
}

const DAILY_INTEREST = 0.02
const DAILY_PREMIUM = 0.1

const UNIT = 1000000

function deviation(a, b) {
    const m = a.abs().gt(b.abs()) ? a.abs() : b.abs()
    return a.sub(b).mul(UNIT).div(m).toNumber() / UNIT
}

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

    async function compare(pool, derivable1155, dailyInterest = 0, feeRate = 0, tolerance = 15) {
        let {rA, rB, rC, state} = await pool.contract.callStatic.compute(derivable1155.address, feeRate, 0, 0)
        const timeRate = 24*60
        await time.increase(SECONDS_PER_DAY / timeRate)
        await pool.swap(SIDE_R, SIDE_C, 1)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(derivable1155.address, feeRate, 0, 0)

        if (dailyInterest > 0) {
            rA = rA.sub(rA.mul(UNIT*dailyInterest).div(UNIT*timeRate))
            rB = rB.sub(rB.mul(UNIT*dailyInterest).div(UNIT*timeRate))
            rC = state.R.sub(rA).sub(rB)
        }

        const premium = rA.sub(rB).abs().shr(1)
            .mul(rA.add(rB)).div(state.R)
            .mul(UNIT*DAILY_PREMIUM).div(UNIT*timeRate)

        let premiumAExpected
        let premiumBExpected
        let premiumCExpected

        if (rA.gt(rB)) {
            premiumAExpected = bn(0).sub(premium)
            premiumBExpected = premium
            // premiumCExpected = bn(0)
        } else {
            premiumBExpected = bn(0).sub(premium)
            premiumAExpected = premium
            // premiumCExpected = bn(0)
        }
        
        const premiumA = rA1.sub(rA)
        const premiumB = rB1.sub(rB)
        // const premiumC = rC1.sub(rC)

        expect(Math.abs(deviation(premiumA, premiumAExpected)), 'premium A').lte(1/tolerance)
        expect(Math.abs(deviation(premiumB, premiumBExpected)), 'premium B').lte(1/tolerance)
        expect(Math.abs(deviation(rC1, rC)), 'premium C').equal(0)
        // expect(Math.abs(deviation(premiumC, premiumCExpected)), 'premium C').lte(1/tolerance)
    }
    it("Apply premium: instant = no elapsed", async function () {
        const { derivablePools, derivable1155, feeRate, utr, weth, owner } = await loadFixture(fixture)
        const pool = derivablePools[0]

        await weth.deposit({
            value: numberToWei(456)
        })
        await weth.approve(utr.address, ethers.constants.MaxUint256)

        await utr.exec([], [{
            inputs: [{
                mode: PAYMENT,
                eip: 20,
                token: weth.address,
                id: 0,
                amountIn: numberToWei(1),
                recipient: pool.contract.address,
            }],
            code: pool.contract.address,
            data: (await pool.swap(
                SIDE_R,
                SIDE_A,
                numberToWei(1),
                {
                    populateTransaction: true,
                    recipient: owner.address,
                    payer: owner.address,
                },
            )).data,
        }], { gasLimit: 1000000 })

        await utr.exec([], [{
            inputs: [{
                mode: PAYMENT,
                eip: 20,
                token: weth.address,
                id: 0,
                amountIn: numberToWei(1),
                recipient: pool.contract.address,
            }],
            code: pool.contract.address,
            data: (await pool.swap(
                SIDE_R,
                SIDE_C,
                numberToWei(1),
                {
                    populateTransaction: true,
                    recipient: owner.address,
                    payer: owner.address,
                },
            )).data,
        }, {
            inputs: [{
                mode: PAYMENT,
                eip: 1155,
                token: derivable1155.address,
                id: packId(SIDE_C, pool.contract.address),
                amountIn: numberToWei(1),
                recipient: pool.contract.address,
            }],
            code: pool.contract.address,
            data: (await pool.swap(
                SIDE_C,
                SIDE_R,
                numberToWei(1),
                {
                    populateTransaction: true,
                    recipient: owner.address,
                    payer: owner.address,
                },
            )).data,
        }], { gasLimit: 1000000 })
    })

    it("Apply premium: Long", async function () {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)

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
        
        await compare(pool, derivable1155, 0, feeRate, 7)
    })

    it("Apply interest and premium: Long - Interest 4%", async function () {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)

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
        
        await compare(pool, derivable1155, DAILY_INTEREST, feeRate, 9)
    })

    it("Apply premium continuos: After a month - Long", async function () {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)

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

        await time.increase(SECONDS_PER_DAY * 30)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
        await compare(pool, derivable1155, 0, feeRate, 7)
    })

    it("Apply interest and premium continuous: After a month - Long - Interest 4%", async function () {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)

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

        await time.increase(SECONDS_PER_DAY * 30)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
        await compare(pool, derivable1155, DAILY_INTEREST, feeRate, 1.15)
    })

    it("Apply premium: Short", async function () {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)

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
        
        await compare(pool, derivable1155, 0, feeRate, 10)
    })

    it("Apply interest and premium: Short - Interest 4%", async function () {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)

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
        
        await compare(pool, derivable1155, DAILY_INTEREST, feeRate, 9)
    })

    it("Apply premium continuos: After a month - Short", async function () {
        const { derivablePools, derivable1155, feeRate} = await loadFixture(fixture)

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

        await time.increase(SECONDS_PER_DAY * 30)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
        await compare(pool, derivable1155, 0, feeRate, 7)
    })

    it("Apply interest and premium continuous: After a month - Short - Interest 4%", async function () {
        const { derivablePools, derivable1155, feeRate} = await loadFixture(fixture)

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

        await time.increase(SECONDS_PER_DAY * 30)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            1
        )
        
       await compare(pool, derivable1155, DAILY_INTEREST, feeRate, 1.15)
    })
})

describe("Apply premium R too big", function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        halfLife: bn(toHalfLife(DAILY_INTEREST)),
        premiumHL: bn(toHalfLife(DAILY_PREMIUM)),
        mark: bn('13179171373343029902768196957842336318319'),
        a: bn('1000'),
        b: bn('1001'),
    }], {
        logicName: 'View',
        initReserved: 3,
        feeRate: 0
    })
    
    it("Test", async function () {
        const { derivablePools, derivable1155} = await loadFixture(fixture)

        const pool = derivablePools[0]

        await time.increase(SECONDS_PER_DAY * 365)

        await pool.swap(
            SIDE_R,
            SIDE_C,
            numberToWei(1)
        )
    })
})