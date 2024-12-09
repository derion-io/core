
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { SIDE_A, SIDE_R, SIDE_B, SIDE_C } = require("./shared/constant");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { numberToWei, bn, weiToNumber, feeToOpenRate } = require("./shared/utilities");
const { baseParams } = require("./shared/baseParams");

use(solidity)

const opts = {
  gasLimit: 30000000
}

const feeRates = [0.03, 0.005, 0.95, 0.999] 

feeRates.forEach(async feeRate => {
  const fixture = await loadFixtureFromParams([{
    ...baseParams,
    premiumHL: bn(1).shl(128).div(2)
  }, {
    ...baseParams,
    premiumHL: bn(1).shl(128).div(2),
    openRate: feeToOpenRate(feeRate)
  }])

  describe(`Open rate ${feeRate}`, function () {
    it("Buy long", async function () {
      const {derivablePools} = await loadFixture(fixture)
      const pool = derivablePools[0]
      const poolWithOpenFee = derivablePools[1]

      const amountOut = await pool.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(1),
        { static: true }
      )


      const amountOutWithFee = await poolWithOpenFee.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(1),
        { static: true }
      )

      expect(Number(weiToNumber(amountOutWithFee))/Number(weiToNumber(amountOut)))
      .to.be.closeTo(1- feeRate, 1e10)
    })
  
    it("Buy short", async function () {
      const {derivablePools} = await loadFixture(fixture)

      const pool = derivablePools[0]
      const poolWithOpenFee = derivablePools[1]
      const amountOut = await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
        { static: true }
      )

      const amountOutWithFee = await poolWithOpenFee.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
        { static: true }
      )
      expect(Number(weiToNumber(amountOutWithFee))/Number(weiToNumber(amountOut)))
      .to.be.closeTo(1- feeRate, 1e10)
    })

    it("LP should increase value after open position", async function () {
      const {derivablePools} = await loadFixture(fixture)
      const poolWithOpenFee = derivablePools[1]

      const amountOutLP = await poolWithOpenFee.swap(
        SIDE_C,
        SIDE_R,
        '1000',
        { static: true }
      )

      await poolWithOpenFee.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(1),
      )

      const amountOutLP1 = await poolWithOpenFee.swap(
        SIDE_C,
        SIDE_R,
        '1000',
        { static: true }
      )
  
      await poolWithOpenFee.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(1),
      )
      
      const amountOutLP2 = await poolWithOpenFee.swap(
        SIDE_C,
        SIDE_R,
        '1000',
        { static: true }
      )

      expect(amountOutLP2).to.be.gt(amountOutLP1)
      expect(amountOutLP1).to.be.gt(amountOutLP)
    })
  })
})
