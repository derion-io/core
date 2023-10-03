const {
  loadFixture, time,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { ethers } = require("hardhat")
const { baseParams } = require("./shared/baseParams")
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { numberToWei, packId, bn, swapToSetPriceMock, weiToNumber } = require("./shared/utilities")

const ELLAPSED_TIME = 86400 * 365

function toHalfLife(dailyRate) {
  if (dailyRate == 0) {
      return 0
  }
  return Math.round(dailyRate == 0 ? 0 : 86400 / Math.log2(1 / (1 - dailyRate)))
}

const UNIT = 1000000

function deviation(a, b) {
  const m = a.abs().gt(b.abs()) ? a.abs() : b.abs()
  return a.sub(b).mul(UNIT).div(m).toNumber() / UNIT
}

describe("View", function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    halfLife: bn(19932680),
  },
  {
    ...baseParams,
    halfLife: bn(toHalfLife(0.03)),
    premiumHL: bn(toHalfLife(0.1)),
  }], {
    logicName: "View",
    feeRate: 5,
    callback: async function ({ derivablePools, uniswapPair }) {
      const pool = derivablePools[0]
      await pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(10),
      )

      const FlashloanAttack = await ethers.getContractFactory('FlashloanAttack');
      const flashloan = await FlashloanAttack.deploy(uniswapPair.address, pool.contract.address)

      return { flashloan }
    }
  })

  describe("compute", function () {
    async function testCompute(side, price, closeTo = false) {
      const { owner, derivablePools, derivable1155, usdc, weth, uniswapPair, feeRate } = await loadFixture(fixture)
      const pool = derivablePools[0]

      if (price)
        await swapToSetPriceMock({
          quoteToken: usdc,
          baseToken: weth,
          uniswapPair,
          targetSpot: price.spot,
          targetTwap: price.twap
        })

      const tokenBefore = await derivable1155.balanceOf(owner.address, packId(side, pool.contract.address))
      await pool.swap(
        SIDE_R,
        side,
        numberToWei(1),
      )

      const tokenAfter = await derivable1155.balanceOf(owner.address, packId(side, pool.contract.address))
      const amountIn = tokenAfter.sub(tokenBefore)

      await time.increase(ELLAPSED_TIME)

      const { rA, sA, rB, sB, rC, sC } = await pool.contract.callStatic.compute(derivable1155.address, feeRate)

      let r = rB
      let s = sB
      if (side == SIDE_A) {
        r = rA
        s = sA
      } else if (side == SIDE_C) {
        r = rC
        s = sC
      }

      const amountOut = await pool.swap(
        side,
        SIDE_R,
        amountIn,
        { static: true }
      )
      if (closeTo) 
        expect(Number(weiToNumber(amountIn.mul(r).div(s)))).closeTo(Number(weiToNumber(amountOut)), 1e-17)
      else
        expect(amountIn.mul(r).div(s)).gte(amountOut.sub(2)).lte(amountOut.add(2))
    }

    it("Short, twap == spot", async function () {
      await testCompute(SIDE_B, null)
    })

    it("Short, twap != spot", async function () {
      await testCompute(SIDE_B, {spot: 1500, twap: 1490})
    })

    it("Short, deleverage long", async function () {
      await testCompute(SIDE_B, {spot: 15000, twap: 15000})
    })

    it("Short, deleverage short", async function () {
      await testCompute(SIDE_B, {spot: 150, twap: 150})
    })

    it("Long, twap == spot", async function () {
      await testCompute(SIDE_A, null)
    })

    it("Long, twap != spot", async function () {
      await testCompute(SIDE_A, {spot: 1500, twap: 1490})
    })

    it("Long, deleverage long", async function () {
      await testCompute(SIDE_A, {spot: 15000, twap: 15000})
    })

    it("Long, deleverage short", async function () {
      await testCompute(SIDE_A, {spot: 150, twap: 150})
    })

    it("LP, twap == spot", async function () {
      await testCompute(SIDE_C, null, true)
    })

    it("LP, twap != spot", async function () {
      await testCompute(SIDE_C, {spot: 1500, twap: 1490}, true)
    })

    it("LP, deleverage long", async function () {
      await testCompute(SIDE_C, {spot: 15000, twap: 15000})
    })

    it("LP, deleverage short", async function () {
      await testCompute(SIDE_C, {spot: 150, twap: 150})
    })
  })

  describe('compute: after no activity', function () {
    async function openWaitClose(pid, price) {
      const {
        weth,
        usdc,
        uniswapPair,
        accountA,
        derivablePools,
        derivable1155,
        feeRate,
      } = await loadFixture(fixture);
      const pool = derivablePools[pid].connect(accountA);
      await pool.swap(SIDE_R, SIDE_A, numberToWei(1));
      await pool.swap(SIDE_R, SIDE_B, numberToWei(1));
      const balanceA = await derivable1155.balanceOf(
        accountA.address,
        packId(SIDE_A, pool.contract.address)
      );
      const balanceB = await derivable1155.balanceOf(
        accountA.address,
        packId(SIDE_B, pool.contract.address)
      );

      const deviations = {
        7: 0.001,
        30: 0.35,
        365: 0.6,
      }
      for (let DURATION of [7, 30, 365]) {
        for (let i = 0; i < 10; ++i) {
          await time.increase(DURATION * 86400 / 10)
          await swapToSetPriceMock({
            quoteToken: usdc,
            baseToken: weth,
            uniswapPair,
            targetSpot: 1000 + 1000 * Math.random(),
            targetTwap: 1000 + 1000 * Math.random(),
          })
        }
  
        const [{ rA, sA, rB, sB }, amountOutA, amountOutB] = await Promise.all([
          pool.contract.callStatic.compute(derivable1155.address, feeRate),
          pool.swap(SIDE_A, SIDE_R, balanceA, { static: true }),
          pool.swap(SIDE_B, SIDE_R, balanceB, { static: true }),
        ]);
  
        expect(Math.abs(deviation(balanceA.mul(rA), amountOutA.mul(sA)))).lte(deviations[DURATION])
        expect(Math.abs(deviation(balanceB.mul(rB), amountOutB.mul(sB)))).lte(deviations[DURATION])
      }
    }

    it("Compute long time with no tx: default", async function () {
      await openWaitClose(0, null)
    });

    it("Compute long time with no tx: premium 1%, interest 3%, price 1500 -> 2000", async function () {
      await openWaitClose(1, 2000)
    });
  })
})
