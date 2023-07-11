const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { expect } = require("chai")
const { _selectPrice, _evaluate } = require("../test/shared/AsymptoticPerpetual")
const { baseParams } = require("../test/shared/baseParams")
const { SIDE_A, SIDE_B, SIDE_C, SIDE_R } = require("../test/shared/constant")
const { loadFixtureFromParams } = require("../test/shared/scenerios")
const { bn, packId, numberToWei, paramToConfig, weiToNumber } = require("../test/shared/utilities")

const HALF_LIFE = 19932680
const FEE_RATE = 12
const SECONDS_PER_DAY = 86400

const configs = [
  {
    hl: 19932680,
    fee: 12
  },
  {
    hl: 1993268,
    fee: 12
  },
  {
    hl: 19932680,
    fee: 5
  }
]

function toDailyRate(HALF_LIFE) {
  return HALF_LIFE == 0 ? 0 : 1 - 2 ** (-SECONDS_PER_DAY / HALF_LIFE)
}

configs.forEach(({hl, fee}) => {
  const dailyInterestRate = toDailyRate(hl)

  describe(`Frequency Test: interest rate - ${dailyInterestRate}, fee - ${fee}`, function() {
    const fixture = loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(hl)
    }], { feeRate: fee })
  
    it('Test', async function() {
      const { derivablePools, oracleLibrary, params, derivable1155, owner, feeReceiver, weth } = await loadFixture(fixture)
      const pool = derivablePools[0]
      const config = paramToConfig(params[0])
  
      const C_ID = packId(SIDE_C, pool.contract.address);
  
      await pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(20),
        0
      )
      await pool.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(20),
        0
      )
      await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(20),
        0
      )
  
      const state = await pool.contract.getStates()
      const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
      const price = _selectPrice(
          config,
          state,
          { min: oraclePrice.spot, max: oraclePrice.twap },
          0x00,
          0x10,
          bn(config.INIT_TIME).add(1)
      )
      const eval = _evaluate(price.market, state)
      const positionReserved = eval.rA.add(eval.rB)
  
      const rC = await pool.swap(
        SIDE_C,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, C_ID),
        0,
        { static: true }
      )
      
      const curTime = await time.latest()
      
      for (let index = 0; index < 1000; index++) {
        let long, short
        long = pool.swap(
          (index % 2) ? SIDE_R : SIDE_A,
          (index % 2) ? SIDE_A : SIDE_R,
          bn(2),
          0
        )
        short = pool.swap(
          (index % 2) ? SIDE_R : SIDE_B,
          (index % 2) ? SIDE_B : SIDE_R,
          bn(2),
          0
        )
        await Promise.all([long, short])
        await time.increase(100)
      }
      const feeAmount = await weth.balanceOf(feeReceiver.address)
  
      const ellapsed = await time.latest() - curTime
  
      const rCAfter = await pool.swap(
        SIDE_C,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, C_ID),
        0,
        { static: true }
      )
      const period = ellapsed / SECONDS_PER_DAY
      const interestRate = 1 - (1 - dailyInterestRate) ** period
      const interest = rCAfter.sub(rC)
  
      const feeRate = 1 - (1 - (dailyInterestRate / fee)) ** period
      const pReservedAfterInterest = positionReserved.mul(((1 - interestRate) * 1e8).toFixed(0)).div(1e8)
      const actualFeeRate = Number(weiToNumber(feeAmount)) / Number(weiToNumber(pReservedAfterInterest))
      expect(
        Number(weiToNumber(interest))/Number(weiToNumber(positionReserved))/interestRate
      ).to.be.closeTo(1, 0.003)
      expect(feeRate / actualFeeRate).to.be.closeTo(1, 0.04)
    })
  })
})
