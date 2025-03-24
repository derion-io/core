const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A, SIDE_C, SIDE_B } = require("./shared/constant")
const { numberToWei, weiToNumber, bn, packId } = require("./shared/utilities")
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

describe("Premium", async function () {
    const fixture = await loadFixtureFromParams([{
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
        let {rA, rB, rC, state} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        const timeRate = 24*60
        await time.increase(SECONDS_PER_DAY / timeRate)
        await pool.swap(SIDE_R, SIDE_C, 1)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(feeRate, 0, 0)

        if (dailyInterest > 0) {
            rA = rA.sub(rA.mul(UNIT*dailyInterest).div(UNIT*timeRate))
            rB = rB.sub(rB.mul(UNIT*dailyInterest).div(UNIT*timeRate))
            rC = state.R.sub(rA).sub(rB)
        }

        const premium = rA.sub(rB).abs()
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

    it("Premium: 1-1-1", async function() {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const {rA, rB, rC} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        await time.increase(SECONDS_PER_DAY)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rA.sub(rA1).isZero(), 'LONG premmium must be zero').to.be.true
        expect(rB.sub(rB1).isZero(), 'SHORT premmium must be zero').to.be.true
        expect(rC.sub(rC1), 'LP premmium').equals(0)
        await time.increase(SECONDS_PER_DAY * 365 * 50)
        const {rA: rA2, rB: rB2, rC: rC2} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rA2.sub(rB2).abs()).lte(2, 'eventually rA == rB')
        expect(rC.sub(rC2).abs()).lte(2, 'eventually rC unchanged')
    })

    it("Premium: 1-0-0", async function() {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)
        const pool = derivablePools[0]

        // remove all B and C
        await pool.swap(SIDE_B, SIDE_R, (await derivable1155.balanceOf(pool.contract.signer.address, packId(SIDE_B, pool.contract.address))))
        await pool.swap(SIDE_C, SIDE_R, (await derivable1155.balanceOf(pool.contract.signer.address, packId(SIDE_C, pool.contract.address))))

        const {rA, rB, rC} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        await time.increase(SECONDS_PER_DAY)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rC.sub(rC1), 'LP premmium').equals(0)
        const premium = Number(weiToNumber(rA.mul(Math.floor(DAILY_PREMIUM * UNIT)).div(UNIT)))
        expect(Number(weiToNumber(rA.sub(rA1)) / premium), 'LONG premmium').closeTo(1, 0.06)
        expect(Number(weiToNumber(rB1.sub(rB)) / premium), 'SHORT premmium').closeTo(1, 0.06)

        await time.increase(SECONDS_PER_DAY * 365 * 50)
        const {rA: rA2, rB: rB2, rC: rC2} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rA2.sub(rB2).abs()).lte(2, 'eventually rA == rB')
        expect(rC.sub(rC2).abs()).lte(2, 'eventually rC unchanged')
    })

    it("Premium: 1-0-1", async function() {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)
        const pool = derivablePools[0]

        // remove all B and C
        await pool.swap(SIDE_B, SIDE_R, (await derivable1155.balanceOf(pool.contract.signer.address, packId(SIDE_B, pool.contract.address))))

        const {rA, rB, rC} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        await time.increase(SECONDS_PER_DAY)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rC.sub(rC1), 'LP premmium').equals(0)
        const premium = Number(weiToNumber(rA.mul(Math.floor(DAILY_PREMIUM * UNIT)).div(UNIT)))
        expect(Number(weiToNumber(rA.sub(rA1)) / (premium/2)), 'LONG premmium').closeTo(1, 0.0000001)
        expect(Number(weiToNumber(rB1.sub(rB)) / (premium/2)), 'SHORT premmium').closeTo(1, 0.0000001)

        await time.increase(SECONDS_PER_DAY * 365 * 50)
        const {rA: rA2, rB: rB2, rC: rC2} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rA2.sub(rB2).abs()).lte(2, 'eventually rA == rB')
        expect(rC.sub(rC2).abs()).lte(2, 'eventually rC unchanged')
    })

    it("Premium: 0-1-0", async function() {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)
        const pool = derivablePools[0]

        // remove all B
        await pool.swap(SIDE_A, SIDE_R, (await derivable1155.balanceOf(pool.contract.signer.address, packId(SIDE_A, pool.contract.address))))
        await pool.swap(SIDE_C, SIDE_R, (await derivable1155.balanceOf(pool.contract.signer.address, packId(SIDE_C, pool.contract.address))))

        const {rA, rB, rC} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        await time.increase(SECONDS_PER_DAY)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rC.sub(rC1), 'LP premmium').equals(0)
        const premium = Number(weiToNumber(rB.mul(Math.floor(DAILY_PREMIUM * UNIT)).div(UNIT)))
        expect(Number(weiToNumber(rA1.sub(rA)) / (premium)), 'LONG premmium').closeTo(1, 0.06)
        expect(Number(weiToNumber(rB.sub(rB1)) / (premium)), 'SHORT premmium').closeTo(1, 0.06)

        await time.increase(SECONDS_PER_DAY * 365 * 50)
        const {rA: rA2, rB: rB2, rC: rC2} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rA2.sub(rB2).abs()).lte(2, 'eventually rA == rB')
        expect(rC.sub(rC2).abs()).lte(2, 'eventually rC unchanged')
    })

    it("Premium: 0-1-1", async function() {
        const { derivablePools, derivable1155, feeRate } = await loadFixture(fixture)
        const pool = derivablePools[0]

        // remove all A
        await pool.swap(SIDE_A, SIDE_R, numberToWei(1).sub(1000))

        const {rA, rB, rC} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        await time.increase(SECONDS_PER_DAY)
        const {rA: rA1, rB: rB1, rC: rC1} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rC.sub(rC1), 'LP premmium').equals(0)
        const premium = numberToWei(DAILY_PREMIUM)
        expect(Number(weiToNumber(rA1.sub(rA)) / (DAILY_PREMIUM/2)), 'LONG premmium').closeTo(1, 0.03)
        expect(Number(weiToNumber(rB.sub(rB1)) / (DAILY_PREMIUM/2)), 'SHORT premmium').closeTo(1, 0.03)

        await time.increase(SECONDS_PER_DAY * 365 * 50)
        const {rA: rA2, rB: rB2, rC: rC2} = await pool.contract.callStatic.compute(feeRate, 0, 0)
        expect(rA2.sub(rB2).abs()).lte(2, 'eventually rA == rB')
        expect(rC.sub(rC2).abs()).lte(2, 'eventually rC unchanged')
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

describe("Apply premium R too big", async function () {
    const fixture = await loadFixtureFromParams([{
        ...baseParams,
        halfLife: bn(toHalfLife(DAILY_INTEREST)),
        premiumHL: bn(toHalfLife(DAILY_PREMIUM)),
        mark: bn('13179171373343029902768196957842336318319'),
        a: bn('1000'),
        b: bn('1000'),
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