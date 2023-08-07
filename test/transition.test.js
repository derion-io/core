const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { bn, numberToWei, packId } = require("./shared/utilities");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require("./shared/constant");

use(solidity)

const HALF_LIFE = 10 * 365 * 24 * 60 * 60
const scenerios = [
  {
    desc: "Mark 25",
    scenerio: loadFixtureFromParams([{
      ...baseParams,
      mark: bn(40).shl(128),
      premiumHL: bn(1).shl(128).div(2),
      halfLife: bn(HALF_LIFE)
    }])
  },
  {
    desc: "Mark 50",
    scenerio: loadFixtureFromParams([{
      ...baseParams,
      mark: bn(35).shl(128),
      premiumHL: bn(1).shl(128).div(2),
      halfLife: bn(HALF_LIFE)
    }])
  }
]

describe("Decay funding rate", function () {

  scenerios.forEach(scene => {
    describe(`Pool ${scene.desc}`, function () {
      async function amountInMustGteAmountInDesired(longAmount, rateLongSwapback, shortAmount, rateShortSwapback, period, prefix = '( )') {
        const { derivablePools, accountB, accountA, weth, derivable1155 } = await loadFixture(scene.scenerio);
        const poolA = derivablePools[0].connect(accountA)
        const poolB = derivablePools[0].connect(accountB)
        const A_ID = packId(SIDE_A, poolA.contract.address)
        const B_ID = packId(SIDE_B, poolA.contract.address)

        await poolA.swap(
          SIDE_R,
          SIDE_C,
          numberToWei(1),
        )
        
        const wethABegin = await weth.balanceOf(accountA.address)
        const wethBBegin = await weth.balanceOf(accountB.address)
        await poolA.swap(
          SIDE_R,
          SIDE_A,
          longAmount,
        )
        await poolB.swap(
          SIDE_R,
          SIDE_B,
          shortAmount,
        )
        
        const wethAAfter = await weth.balanceOf(accountA.address)
        const wethBAfter = await weth.balanceOf(accountB.address)
        if (period > 0) {
          await time.increase(period)
        }
        expect(wethABegin.sub(wethAAfter)).to.be.lte(longAmount, `${prefix}: Long R->A In > Desired`)
        expect(wethBBegin.sub(wethBAfter)).to.be.lte(shortAmount, `${prefix}: Long R->B In > Desired`)

        const tokenAAmountBefore = await derivable1155.balanceOf(accountA.address, A_ID)
        const tokenBAmountBefore = await derivable1155.balanceOf(accountB.address, B_ID)

        const amountAIn = tokenAAmountBefore.mul(rateLongSwapback).div(100)
        const amountBIn = tokenBAmountBefore.mul(rateShortSwapback).div(100)
        await poolA.swap(
          SIDE_A,
          SIDE_R,
          amountAIn,
        )
        await poolB.swap(
          SIDE_B,
          SIDE_R,
          amountBIn,
        )
        
        const tokenAAmountAfter = await derivable1155.balanceOf(accountA.address, A_ID)
        const tokenBAmountAfter = await derivable1155.balanceOf(accountB.address, B_ID)
        expect(tokenAAmountBefore.sub(tokenAAmountAfter), `${prefix}: amountInA`).lte(amountAIn)
        expect(tokenBAmountBefore.sub(tokenBAmountAfter), `${prefix}: amountInB`).lte(amountBIn)
      }
      describe(`${scene.desc} ` + "In > Desired", function () {
        it("1e Long - 100% back, 1e Short - 100% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            100,
            numberToWei(1),
            100,
            "1e Long - 50% back, 1e Short - 50% back"
          )
        })
        it("1e Long - 50% back, 0.5e Short - 50% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            50,
            numberToWei(0.5),
            50,
            "1e Long - 50% back, 0.5e Short - 50% back"
          )
        })
        it("1e Long - 30% back, 1e Short - 40% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            30,
            numberToWei(1),
            40,
            "1e Long - 30% back, 1e Short - 40% back"
          )
        })
        it("0.7e Long - 33% back, 0.9e Short - 49% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(0.7),
            33,
            numberToWei(0.9),
            49,
            "0.7e Long - 33% back, 0.9e Short - 49% back"
          )
        })
        it("1e Long - 90% back, 0.1e Short - 100% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            90,
            numberToWei(0.1),
            100,
            "1e Long - 90% back, 0.1e Short - 100% back"
          )
        })
        it("0.1e Long - 70% back, 1e Short - 30% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(0.1),
            70,
            numberToWei(1),
            30,
            "0.1e Long - 70% back, 1e Short - 30% back"
          )
        })
        it("0.7e Long - 33% back, 0.9e Short - 49% back, wait HL", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(0.7),
            33,
            numberToWei(0.9),
            49,
            HALF_LIFE,
            "0.7e Long - 33% back, 0.9e Short - 49% back"
          )
        })
        it("1e Long - 90% back, 0.1e Short - 100% back, wait 0.5 HL", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            90,
            numberToWei(0.1),
            100,
            0.5 * HALF_LIFE,
            "1e Long - 90% back, 0.1e Short - 100% back"
          )
        })
      })
    });
  });
})