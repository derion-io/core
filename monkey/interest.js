const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { baseParams } = require("../test/shared/baseParams")
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require("../test/shared/constant")
const { loadFixtureFromParams } = require("../test/shared/scenerios")
const { bn, numberToWei, swapToSetPriceMock, packId, weiToNumber } = require("../test/shared/utilities")
const seedrandom = require('seedrandom');
const { ethers } = require("hardhat");

const AddressOne = "0x0000000000000000000000000000000000000001";

// Global PRNG: set Math.random.
const seed = ethers.utils.randomBytes(32)
console.log('Random Seed:', ethers.utils.hexlify(seed))
seedrandom(seed, { global: true });

use(solidity)

const SECONDS_PER_DAY = 86400
const HLs = [19932680, 1966168] // 0.3%, 3%

function toDailyRate(HALF_LIFE, precision = 4) {
  if (HALF_LIFE == 0) {
    return 0
  }
  const rate = 1 - 2 ** (-SECONDS_PER_DAY / HALF_LIFE)
  return Math.round(rate * 10**precision) / 10**precision
}

HLs.forEach(HALF_LIFE => {
  const dailyInterestRate = toDailyRate(HALF_LIFE)
  describe(`Monkey Test: Interest rate ${dailyInterestRate*100}%`, function() {
    const fixture = await loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(HALF_LIFE),
      premiumHL: 0,
    }])

    it('Test', async function() {
      const {derivablePools, owner, derivable1155, uniswapPair, usdc, weth} = await loadFixture(fixture)
      const pool = derivablePools[0]

      const A_ID = packId(SIDE_A, pool.contract.address);
      const B_ID = packId(SIDE_B, pool.contract.address);
      const C_ID = packId(SIDE_C, pool.contract.address);

      await pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(20),
      )
      await pool.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(20),
      )
      await pool.swap(
        SIDE_R,
        SIDE_B,
        numberToWei(20),
      )
      await time.increase(SECONDS_PER_DAY)

      let currentPrice = 1500
      for (let i = 0; i < 1000; i++) {
        const rand = Math.random()
        if (rand < 2/3) { //swap
          const isBuy = Math.random() < 0.5
          // Choose side
          const sideRand = Math.random()
          let amount = 0.1 + 3 * Math.random()
          let side = SIDE_A
          if (sideRand < 4/9) {
            side = SIDE_B
          } else if (sideRand < 5/9) {
            side = SIDE_C
          } 
          console.log(`${i} - ${isBuy ? 'Buy' : 'Sell'} - ${side} - ${amount}`)
          if (isBuy) {
            await pool.swap(
              SIDE_R,
              side,
              numberToWei(amount),
            )
          } else {
            if (side == SIDE_C) {
              const supplyC =  Number(weiToNumber(await derivable1155.totalSupply(C_ID)))
              amount = (supplyC * amount / 10).toFixed(6)
            } else if (side == SIDE_A) {
              const supplyA =  Number(weiToNumber(await derivable1155.totalSupply(A_ID)))
              amount = (supplyA * amount / 10).toFixed(6)
            } else {
              const supplyB =  Number(weiToNumber(await derivable1155.totalSupply(B_ID)))
              amount = (supplyB * amount / 10).toFixed(6)
            }
            await pool.swap(
              side,
              SIDE_R,
              numberToWei(amount),
            )
          }
          
        } else { //change price
          const targetPrice = 1500 + 50 - 100 * Math.random()
          console.log(`${i} - change price - from ${currentPrice} - to ${targetPrice}`)
          swapToSetPriceMock({
            quoteToken: usdc,
            baseToken: weth,
            uniswapPair,
            targetSpot: targetPrice,
            targetTwap: targetPrice
          })
          currentPrice = targetPrice
        }
        const wait = Math.round(Math.random() * SECONDS_PER_DAY)
        if (wait > 0) {
          await time.increase(wait)
        }
      }

      const exhaust = async(side) => {
        const id = packId(side, pool.contract.address)
        const balance = await derivable1155.balanceOf(owner.address, id)
        if(balance.gt(0)) {
          // console.log(side, balance.toString())
          await pool.swap(side, SIDE_R, balance)
        }
      }

      let r = await weth.balanceOf(pool.contract.address)
      while (r.gt(0)) {
        for (const side of [SIDE_A, SIDE_B, SIDE_C]) {
          await exhaust(side)
        }
        const r1 = await weth.balanceOf(pool.contract.address)
        if (r1.gte(r)) {
          break
        }
        r = r1
      }

      const [sA, sB, sC, R, [bA, bB, bC, oA, oB, oC]] = await Promise.all([
        derivable1155.totalSupply(A_ID),
        derivable1155.totalSupply(B_ID),
        derivable1155.totalSupply(A_ID),
        weth.balanceOf(pool.contract.address),
        derivable1155.balanceOfBatch([
          AddressOne, AddressOne, AddressOne,
          owner.address, owner.address, owner.address,
        ], [
          A_ID, B_ID, C_ID,
          A_ID, B_ID, C_ID,
        ]),
      ])

      // console.log({sA, sB, sC, R, bA, bB, bC, oA, oB, oC})

      expect(sA.sub(bA), 'sA').lte(10000000)
      expect(sB.sub(bB), 'sB').lte(10000000)
      expect(sC.sub(bC), 'sC').lte(10000000)
      expect(R, 'R').lte(400000)
    })
  })
})
