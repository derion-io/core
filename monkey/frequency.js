const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { expect } = require("chai")
const { _selectPrice, _evaluate } = require("../test/shared/AsymptoticPerpetual")
const { baseParams } = require("../test/shared/baseParams")
const { SIDE_A, SIDE_B, SIDE_C, SIDE_R } = require("../test/shared/constant")
const { loadFixtureFromParams } = require("../test/shared/scenerios")
const { bn, packId, numberToWei, paramToConfig, weiToNumber, swapToSetPriceMock, getSqrtPriceFromPrice } = require("../test/shared/utilities")
const seedrandom = require("seedrandom")
const { AddressZero, MaxUint256 } = ethers.constants

const HALF_LIFE = 19932680
const FEE_RATE = 12
const SECONDS_PER_DAY = 86400

const PAYMENT = 0;
const CALLVALUE = 2;

// Global PRNG: set Math.random.
const seed = ethers.utils.randomBytes(32)
console.log('Random Seed:', ethers.utils.hexlify(seed))
seedrandom(seed, { global: true });

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
    }], { 
      feeRate: fee,
      callback: async ({derivablePools, uniswapPair, derivable1155, weth}) => {
        const PoolMulticall = await ethers.getContractFactory("PoolMulticall")
        const poolMulticall = await PoolMulticall.deploy(
          uniswapPair.address,
          derivablePools[0].contract.address,
          derivable1155.address,
          weth.address
        )
        await poolMulticall.deployed()
        return {poolMulticall}
      }
    })
  
    it('Test', async function() {
      const { derivablePools, oracleLibrary, params, derivable1155, uniswapPair, owner, feeReceiver, weth, usdc, poolMulticall } = await loadFixture(fixture)
      const pool = derivablePools[0]
      const config = paramToConfig(params[0])
  
      const C_ID = packId(SIDE_C, pool.contract.address);
      const A_ID = packId(SIDE_A, pool.contract.address);
      const B_ID = packId(SIDE_B, pool.contract.address);

      await weth.transfer(poolMulticall.address, numberToWei(1))
  
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

      await derivable1155.safeTransferFrom(owner.address, poolMulticall.address, A_ID, numberToWei(1), [])
      await derivable1155.safeTransferFrom(owner.address, poolMulticall.address, B_ID, numberToWei(1), [])
  
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
        long = await pool.getSwapParam(
          (index % 2) ? SIDE_R : SIDE_A,
          (index % 2) ? SIDE_A : SIDE_R,
          bn(2),
          0,
        )
        short = await pool.getSwapParam(
          (index % 2) ? SIDE_R : SIDE_B,
          (index % 2) ? SIDE_B : SIDE_R,
          bn(2),
          0,
        )
        const targetPrice = 1500 + 50 - 100 * Math.random()
        const encodedPrice = getSqrtPriceFromPrice(usdc, weth, targetPrice)
        await poolMulticall.exec(encodedPrice, long, short)
        await time.increase(100)
      }
      const feeAmount = await weth.balanceOf(feeReceiver.address)
  
      const ellapsed = await time.latest() - curTime

      await swapToSetPriceMock({
        quoteToken: usdc,
        baseToken: weth,
        uniswapPair,
        targetSpot: 1500,
        targetTwap: 1500
      })
  
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
