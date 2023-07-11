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
    hl: 20000000,
    fee: 12
  },
  {
    hl: 2000000,
    fee: 5
  },
  {
    hl: 20000000,
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
      halfLife: bn(hl),
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
  
    it('Low R, High HL, High Freq Tx', async function() {
      const { derivablePools, oracleLibrary, params, derivable1155, uniswapPair, owner, feeReceiver, weth, usdc, poolMulticall } = await loadFixture(fixture)
      const pool = derivablePools[0]
      const config = paramToConfig(params[0])
  
      const C_ID = packId(SIDE_C, pool.contract.address);
      const A_ID = packId(SIDE_A, pool.contract.address);
      const B_ID = packId(SIDE_B, pool.contract.address);

      await weth.transfer(poolMulticall.address, numberToWei(1))
  
      const rSide = bn(10).pow(9)

      await pool.swap(
        SIDE_R,
        SIDE_C,
        rSide,
        0
      )
      await pool.swap(
        SIDE_R,
        SIDE_A,
        rSide,
        0
      )
      await pool.swap(
        SIDE_R,
        SIDE_B,
        rSide,
        0
      )

      await derivable1155.safeTransferFrom(owner.address, poolMulticall.address, A_ID, rSide, [])
      await derivable1155.safeTransferFrom(owner.address, poolMulticall.address, B_ID, rSide, [])
  
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
      
      const startTime = await time.latest()

      const SIDES = [SIDE_A, SIDE_B]

      for (let i = 0; i < 100; i++) {
        // if (i % 10 == 0) {
        //   console.log(hl, fee, i)
        // }
        const params = [];
        const side = SIDES[Math.floor(Math.random() * SIDES.length)];
        const n = 1 + Math.floor(Math.random() * 4)
        for (let j = 0; j < n; ++j) {
          params.push(
            await pool.getSwapParam(SIDE_R, side, bn(2), 0),
            await pool.getSwapParam(side, SIDE_R, bn(2), 0),
        )
        }
        const targetPrice = 1500 + 50 - 100 * Math.random()
        await time.setNextBlockTimestamp(startTime+1+i)
        await poolMulticall.exec(
          getSqrtPriceFromPrice(usdc, weth, targetPrice),
          getSqrtPriceFromPrice(usdc, weth, targetPrice * (1+Math.random()/100)),
          params,
        )
      }
      const feeAmount = await weth.balanceOf(feeReceiver.address)
  
      const ellapsed = await time.latest() - startTime

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
  
      const feeRate = 1 - (1 - dailyInterestRate) ** (period / fee)
      const pReservedAfterInterest = positionReserved.mul(((1 - interestRate) * 1e8).toFixed(0)).div(1e8)
      const actualFeeRate = Number(weiToNumber(feeAmount)) / Number(weiToNumber(pReservedAfterInterest))
      expect(
        Number(weiToNumber(interest))/Number(weiToNumber(positionReserved))/interestRate
      ).gte(1).lte(1.01)
      console.log('HL', hl, 'FeeRate', fee, 'Results', Number(weiToNumber(interest))/Number(weiToNumber(positionReserved))/interestRate, actualFeeRate / feeRate)
      expect(actualFeeRate / feeRate).gte(1).lte(1.1)
    })
  })
})
