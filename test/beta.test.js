const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { expect } = require("chai")
const { baseParams } = require("./shared/baseParams")
const { SIDE_R, SIDE_A } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { bn, swapToSetPriceMock, numberToWei, weiToNumber } = require("./shared/utilities")

describe('ARB', async function() {
  const fixture = await loadFixtureFromParams([{
    ...baseParams,
    mark: bn('15065122318819189091263847637975040'),
    k: bn('40'),
    halfLife: bn('7456006'),
    premiumHL: bn('170141183460469231731687303715884105728'),
    maturity: bn('3600'),
    maturityVest: bn('60'),
    maturityRate: bn('336879543251729078828740861357450529341'),
    openRate: bn('340282366920938463463374607431768211456')
  }], {
    logicName: 'PoolLogicMock',
    callback: async ({derivablePools, weth, usdc, uniswapPair}) => {
      const pool = derivablePools[0].contract
      const currentTime = await time.latest()
      await pool.loadState(
        bn('0x012189ab781a7d'),
        bn('0xeb6ed57ba2e5'),
        bn(currentTime).shr(1).shl(1),
        currentTime,
        bn('0x012f2a36ecd555'),
        bn('0x012f2a36ecd555'),
        bn('0x9573b178fda2b1')
      )
      swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetTwap: 1855.3457743,
        targetSpot: 1855.4061465
      }, 10**12)

      const reserved = bn('20994974707357290')
      const curReseved = await weth.balanceOf(pool.address)

      await weth.transfer(pool.address, reserved.sub(curReseved))
    },
    initReserved: 0.001,
    initPrice: 1960.0046769835,
    initPriceDeno: 10**12,
    calInitParams: true
  }) 

  for (let e = 0; e < 38; e++) {
    it(`Test amount: 10^${e}`, async function() {
      const amountIn = bn(10).pow(e)
      // console.log('e', e, 'amountIn', amountIn.toString())
      const {derivablePools, accountB, weth} = await loadFixture(fixture)
      const pool = derivablePools[0]
  
      await time.increase(160 * 86400)
  
      const balanceBefore = await weth.balanceOf(accountB.address)
      await pool.connect(accountB).swap(
        SIDE_R,
        SIDE_A,
        amountIn,
      )
      const balanceAfter = await weth.balanceOf(accountB.address)
      const actualValue = balanceBefore.sub(balanceAfter)
      // console.log(actualValue.toString(), amountIn.toString())
      expect(actualValue, `amountIn: ${amountIn.toString()}`).to.be.lte(amountIn)
    })
  }
})