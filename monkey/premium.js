const seedrandom = require("seedrandom");
const { loadFixtureFromParams } = require("../test/shared/scenerios");
const { baseParams } = require("../test/shared/baseParams");
const { swapToSetPriceMock, weiToNumber, bn, numberToWei, packId } = require("../test/shared/utilities");
const { SIDE_A, SIDE_B, SIDE_C, SIDE_R } = require("../test/shared/constant");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

// Global PRNG: set Math.random.
const seed = ethers.utils.randomBytes(32)
console.log('Random Seed:', ethers.utils.hexlify(seed))
seedrandom(seed, { global: true });

const SECONDS_PER_DAY = 86400

function toHalfLife(dailyRate) {
    if (dailyRate == 0) {
        return 0
    }
    return Math.round(dailyRate == 0 ? 0 : SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate)))
}

const configs = [
    {
        interestRate: 0.04,
        premiumRate: 0.01
    },
    {
        interestRate: 0.02,
        premiumRate: 0.02
    },
    {
        interestRate: 0,
        premiumRate: 0.01
    },
    {
        interestRate: 0.04,
        premiumRate: 0
    }
]

configs.forEach(config => {
    describe(`Monkey Test: Interest rate ${config.interestRate}%, Premium ${config.premiumRate}%`, function () {
        const fixture = loadFixtureFromParams([{
            ...baseParams,
            halfLife: bn(toHalfLife(config.interestRate)),
            premiumHL: bn(toHalfLife(config.premiumRate)),
            mark: bn('13179171373343029902768196957842336318319')
        }], {
            logicName: 'View',
            initReserved: 300,
            feeRate: 0
        })

        async function compareWithInterest(pool, derivable1155) {
            const { rA, rB, rC } = await pool.contract.compute(derivable1155.address)
            const rANum = Number(weiToNumber(rA))
            const rBNum = Number(weiToNumber(rB))
            const rCNum = Number(weiToNumber(rC))
            await time.increase(SECONDS_PER_DAY)
    
            const rADecayed = rANum * (1 - config.interestRate)
            const rBDecayed = rBNum * (1 - config.interestRate)
            const rCDecayed = rCNum + (rANum + rBNum) * config.interestRate
    
            await pool.swap(
                SIDE_R,
                SIDE_C,
                1
            )
    
            const { rA: rA1, rB: rB1, rC: rC1 } = await pool.contract.compute(derivable1155.address)
            const rA1Num = Number(weiToNumber(rA1))
            const rB1Num = Number(weiToNumber(rB1))
            const rC1Num = Number(weiToNumber(rC1))
    
            let expectedRA1Num
            let expectedRB1Num
            let expectedRC1Num
    
            if (rADecayed > rBDecayed) {
                const expectedPremium = (rADecayed - rBDecayed) * config.premiumRate
                expectedRA1Num = rADecayed - expectedPremium
                expectedRB1Num = rBDecayed + expectedPremium * rBDecayed / (rBDecayed + rCDecayed)
                expectedRC1Num = rCDecayed + expectedPremium * rCDecayed / (rBDecayed + rCDecayed)
            } else {
                const expectedPremium = (rBDecayed - rADecayed) * config.premiumRate
                expectedRB1Num = rBDecayed - expectedPremium
                expectedRA1Num = rADecayed + expectedPremium * rADecayed / (rADecayed + rCDecayed)
                expectedRC1Num = rCDecayed + expectedPremium * rCDecayed / (rADecayed + rCDecayed)
            }
    
            expect(rA1Num).to.be.closeTo(expectedRA1Num, 1e-3)
            expect(rB1Num).to.be.closeTo(expectedRB1Num, 1e-3)
            expect(rC1Num).to.be.closeTo(expectedRC1Num, 1e-3)
        }
    
        it('Test', async function () {
            const { derivablePools, derivable1155, uniswapPair, usdc, weth } = await loadFixture(fixture)
            const pool = derivablePools[0]

            const A_ID = packId(SIDE_A, pool.contract.address);
            const B_ID = packId(SIDE_B, pool.contract.address);
            const C_ID = packId(SIDE_C, pool.contract.address);

            let currentPrice = 1500
            for (let i = 0; i < 1000; i++) {
                const rand = Math.random()
                if (rand < 2 / 3) { //swap
                    const isBuy = Math.random() < 0.5
                    // Choose side
                    const sideRand = Math.random()
                    let amount = 0.1 + 3 * Math.random()
                    let side = SIDE_A
                    if (sideRand < 4 / 9) {
                        side = SIDE_B
                    } else if (sideRand < 5 / 9) {
                        side = SIDE_C
                    }
                    console.log(`${i} - ${isBuy ? 'Buy' : 'Sell'} - ${side} - ${amount}`)
                    if (isBuy) {
                        await pool.swap(
                            SIDE_R,
                            side,
                            numberToWei(amount),
                        )
                    } else {
                        if (side == SIDE_C) {
                            const supplyC = Number(weiToNumber(await derivable1155.totalSupply(C_ID)))
                            amount = (supplyC * amount / 10).toFixed(6)
                        } else if (side == SIDE_A) {
                            const supplyA = Number(weiToNumber(await derivable1155.totalSupply(A_ID)))
                            amount = (supplyA * amount / 10).toFixed(6)
                        } else {
                            const supplyB = Number(weiToNumber(await derivable1155.totalSupply(B_ID)))
                            amount = (supplyB * amount / 10).toFixed(6)
                        }
                        await pool.swap(
                            side,
                            SIDE_R,
                            numberToWei(amount),
                        )
                    }
    
                } else { //change price
                    const targetPrice = 1500 + 5 - 10 * Math.random()
                    console.log(`${i} - change price - from ${currentPrice} - to ${targetPrice}`)
                    swapToSetPriceMock({
                        quoteToken: usdc,
                        baseToken: weth,
                        uniswapPair,
                        targetSpot: targetPrice,
                        targetTwap: targetPrice
                    })
                    currentPrice = targetPrice
                }
                const wait = Math.round(Math.random() * SECONDS_PER_DAY)
                if (wait > 0) {
                    await time.increase(wait)
                }
            }
    
            await compareWithInterest(pool, derivable1155)
        })
    })
})