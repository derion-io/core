const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("../test/shared/baseParams")
const { loadFixtureFromParams } = require("../test/shared/scenerios")
const { bn, swapToSetPriceMock, numberToWei, packId } = require("../test/shared/utilities")
const { SIDE_R, SIDE_A, SIDE_C } = require("../test/shared/constant")
const { expect } = require("chai")
const seedrandom = require("seedrandom")

const SECONDS_PER_DAY = 60 * 60 * 24

let seed = ethers.utils.randomBytes(32)
// seed = ethers.utils.arrayify('0x5228eb305d22b5f5a8ce749e18ad302a60ca9fb7c5ad34eb68599299ba6090ce')
// seed = ethers.utils.arrayify('0xaf8305e01a98c1e0fa4368993dad4fabaa8616291dbc6d20dc089938225037b3')
// seed = ethers.utils.arrayify('0xd7ffa3398fe033735db31d1fe41c2084504f50a1608f8432b9ac0ed458a5b6ca')
// seed = ethers.utils.arrayify('0x748a5a239736c65d6eb1704553f34755fb6d4e894b012b6d8cea374900ab5182')
// seed = ethers.utils.arrayify('0xc7b2d9a2ff4aeed37dedd21b38a6620ce0f098a5bd03e54716efa6597450bcdd')
console.log('Random Seed:', ethers.utils.hexlify(seed))
seedrandom(seed, { global: true });

for (let index = 0; index < 50; index++) {
  const amount = 1 * Math.random()
  const ellapsedDay = Math.random() * 30
  const price = 1960 + 196 - 1960 * 0.2 * Math.random()
        
  describe(`Helper Rounding: Ellapsed day ${ellapsedDay}, price: ${price}, amount: ${amount}`, function() {
    const k = 40
    const dailyFundingRate = (0.02 * k) / 100
    const premiumHL = bn(1).shl(128).div(2);
  
    const halfLife = Math.round(
      SECONDS_PER_DAY /
      Math.log2(1 / (1 - dailyFundingRate)))
  
    const fixture = loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(halfLife),
      k: bn(k),
      premiumHL: bn(premiumHL),
      mark: bn("15065122318819189091263847637975040"),
      maturity: bn('3600'),
      maturityVest: bn('60'),
      maturityRate: bn('336879543251729078828740861357450529341'),
      openRate: bn('340282366920938463463374607431768211456')
    }], {
      initReserved: 0.001,
      initPrice: 1960.0046769835,
      initPriceDeno: 10**12,
      calInitParams: true,
      callback: async ({derivablePools, accountA}) => {
        const pool = derivablePools[0]
        await pool.connect(accountA).swap(
          SIDE_R,
          SIDE_C,
          numberToWei(0.02),
        )
      }
    })

    it('Test R -> A', async function() {
      const {derivablePools, accountB, weth, usdc, uniswapPair} = await loadFixture(fixture)

      const pool = derivablePools[0]
      const ellapsed = Math.round(ellapsedDay * 86400)
      await time.increase(ellapsed)
      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetTwap: price,
        targetSpot: price * (1+Math.random()/100),
      }, 10**12)

      const balanceBefore = await weth.balanceOf(accountB.address)
      const amountIn = numberToWei(amount)

      await pool.connect(accountB).swap(
        SIDE_R,
        SIDE_A,
        amountIn,
      )
      const balanceAfter = await weth.balanceOf(accountB.address)
      const actualValue = balanceBefore.sub(balanceAfter)
      expect(actualValue).lte(amountIn)
      if (actualValue.lt(amountIn.sub(200))) {
        console.warn('\t', actualValue.toString(), amountIn.toString())
      }
    })

    it('Test C -> R', async function() {
      const {derivablePools, accountA, weth, usdc, uniswapPair, derivable1155} = await loadFixture(fixture)

      const pool = derivablePools[0]
      const ellapsed = Math.round(ellapsedDay * 86400)
      await time.increase(ellapsed)
      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetTwap: price,
        targetSpot: price * (1+Math.random()/100),
      }, 10**12)
      const C_ID = packId(SIDE_C, pool.contract.address);

      const balanceBefore = await derivable1155.balanceOf(accountA.address, C_ID)
      const amountIn = (await derivable1155.balanceOf(accountA.address, C_ID)).sub(1)

      await pool.connect(accountA).swap(
        SIDE_C,
        SIDE_R,
        amountIn,
      )
      const balanceAfter = await derivable1155.balanceOf(accountA.address, C_ID)
      const actualValue = balanceBefore.sub(balanceAfter)
      expect(actualValue).lte(amountIn)
      if (actualValue.lt(amountIn.sub(4))) {
        console.warn('\t', actualValue.toString(), amountIn.toString())
      }
    })
  })
}
