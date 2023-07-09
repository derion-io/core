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
const { numberToWei, packId, bn, swapToSetPriceMock } = require("./shared/utilities")

const ELLAPSED_TIME = 86400 * 365

describe("View", function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    halfLife: bn(19932680)
  }], {
    feeRate: 12,
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
    it("Short, twap == spot", async function () {
      const { owner, derivablePools, derivable1155 } = await loadFixture(fixture)
      const pool = derivablePools[0]

      const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
        0
      )

      const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      const amountIn = tokenAfter.sub(tokenBefore)

      await time.increase(ELLAPSED_TIME)

      const { rA, sA, rB, sB, rC, sC } = await pool.contract.compute(derivable1155.address)

      const amountOut = await pool.swap(
        SIDE_B,
        SIDE_R,
        amountIn,
        0,
        { static: true }
      )

      expect(amountIn.mul(rB).div(sB)).equal(amountOut)
    })

    it("Short, twap != spot", async function () {
      const { owner, derivablePools, derivable1155, usdc, weth, uniswapPair } = await loadFixture(fixture)
      const pool = derivablePools[0]

      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetSpot: 1500,
        targetTwap: 1490
      })

      const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
        0
      )

      const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      const amountIn = tokenAfter.sub(tokenBefore)

      await time.increase(ELLAPSED_TIME)

      const { rA, sA, rB, sB, rC, sC } = await pool.contract.compute(derivable1155.address)

      const amountOut = await pool.swap(
        SIDE_B,
        SIDE_R,
        amountIn,
        0,
        { static: true }
      )

      expect(amountIn.mul(rB).div(sB)).equal(amountOut)
    })

    it("Short, deleverage long", async function () {
      const { owner, derivablePools, derivable1155, usdc, weth, uniswapPair } = await loadFixture(fixture)
      const pool = derivablePools[0]

      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetSpot: 15000,
        targetTwap: 15000
      })

      const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
        0
      )

      const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      const amountIn = tokenAfter.sub(tokenBefore)

      await time.increase(ELLAPSED_TIME)

      const { rA, sA, rB, sB, rC, sC } = await pool.contract.compute(derivable1155.address)

      const amountOut = await pool.swap(
        SIDE_B,
        SIDE_R,
        amountIn,
        0,
        { static: true }
      )

      expect(amountIn.mul(rB).div(sB)).equal(amountOut)
    })

    it("Short, deleverage short", async function () {
      const { owner, derivablePools, derivable1155, usdc, weth, uniswapPair } = await loadFixture(fixture)
      const pool = derivablePools[0]

      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetSpot: 150,
        targetTwap: 150
      })

      const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
        0
      )

      const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
      const amountIn = tokenAfter.sub(tokenBefore)

      await time.increase(ELLAPSED_TIME)

      const { rA, sA, rB, sB, rC, sC } = await pool.contract.compute(derivable1155.address)

      const amountOut = await pool.swap(
        SIDE_B,
        SIDE_R,
        amountIn,
        0,
        { static: true }
      )

      expect(amountIn.mul(rB).div(sB)).equal(amountOut)
    })
  })
})
