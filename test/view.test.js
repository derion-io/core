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

describe("View", function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    halfLife: bn(19932680),
  }], {
    logicName: "View",
    feeRate: 5,
    callback: async function ({ derivablePools, uniswapPair }) {
      const pool = derivablePools[0]
      await pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(10),
        0
      )

      const FlashloanAttack = await ethers.getContractFactory('FlashloanAttack');
      const flashloan = await FlashloanAttack.deploy(uniswapPair.address, pool.contract.address)

      return { flashloan }
    }
  })

  describe("compute", function () {
    async function testCompute(side, price, closeTo = false) {
      const { owner, derivablePools, derivable1155, usdc, weth, uniswapPair } = await loadFixture(fixture)
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
        0
      )

      const tokenAfter = await derivable1155.balanceOf(owner.address, packId(side, pool.contract.address))
      const amountIn = tokenAfter.sub(tokenBefore)

      await time.increase(ELLAPSED_TIME)

      const { rA, sA, rB, sB, rC, sC } = await pool.contract.compute(derivable1155.address)

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
        0,
        { static: true }
      )
      if (closeTo) 
        expect(Number(weiToNumber(amountIn.mul(r).div(s)))).closeTo(Number(weiToNumber(amountOut)), 1e-17)
      else
        expect(amountIn.mul(r).div(s)).equal(amountOut)
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
})
