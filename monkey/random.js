const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("../test/shared/baseParams")
const { loadFixtureFromParams } = require("../test/shared/scenerios")
const { bn, swapToSetPriceMock, numberToWei } = require("../test/shared/utilities")
const { SIDE_R, SIDE_A } = require("../test/shared/constant")
const { expect } = require("chai")
const seedrandom = require("seedrandom")

const SECONDS_PER_DAY = 60 * 60 * 24

const seed = ethers.utils.randomBytes(32)
console.log('Random Seed:', ethers.utils.hexlify(seed))
seedrandom(seed, { global: true });

for (let index = 0; index < 50; index++) {
  // const amountIn = numberToWei(10 * Math.random())
  // const ellapsedDay = Math.random() * 30
  // const price = 1960 + 196 - 1960 * 0.2 * Math.random()
        
  describe('Random scenerio', function() {
    const k = 40
    const dailyFundingRate = (0.02 * k) / 100
    const premiumRate = bn(1).shl(128).div(2);
  
    const halfLife = Math.round(
      SECONDS_PER_DAY /
      Math.log2(1 / (1 - dailyFundingRate)))
  
    const fixture = loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(halfLife),
      k: bn(k),
      premiumRate: bn(premiumRate),
      mark: bn("15065122318819189091263847637975040"),
      maturity: bn('3600'),
      maturityVest: bn('60'),
      maturityRate: bn('336879543251729078828740861357450529341'),
      openRate: bn('340282366920938463463374607431768211456')
    }], {
      initReserved: 0.001,
      initPrice: 1960.0046769835,
      initPriceDeno: 10**12,
      calInitParams: true
    })

    it('Test', async function() {
      const {derivablePools, accountB, weth, usdc, uniswapPair} = await loadFixture(fixture)
      const amount = 0.1 * Math.random()
      const ellapsedDay = Math.random() * 30
      const price = 1960 + 196 - 1960 * 0.2 * Math.random()
      console.log(`Ellapsed day ${ellapsedDay}, price: ${price}, amount: ${amount}`)
      
      const pool = derivablePools[0]
      const ellapsed = Math.round(ellapsedDay * 86400)
      await time.increase(ellapsed)
      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetTwap: price,
        targetSpot: price
      }, 10**12)

      const balanceBefore = await weth.balanceOf(accountB.address)
      const amountIn = numberToWei(amount)

      await pool.connect(accountB).swap(
        SIDE_R,
        SIDE_A,
        amountIn,
        0,
      )
      const balanceAfter = await weth.balanceOf(accountB.address)
      const actualValue = balanceBefore.sub(balanceAfter)
      expect(actualValue, `amountIn: ${amountIn.toString()}`).to.be.lte(amountIn)
    })
  })
}
