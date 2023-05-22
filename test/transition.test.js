const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload } = require("./shared/utilities");
const { scenerio01, scenerio02 } = require("./shared/scenerios");

use(solidity)

const scenerios = [
  {
    desc: "Mark 25",
    scenerio: scenerio01
  },
  {
    desc: "Mark 50",
    scenerio: scenerio02
  }
]

const opts = {
  gasLimit: 30000000
}

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

// const HALF_LIFE = 0

describe("Decay funding rate", function () {

  scenerios.forEach(scene => {
    describe(`Pool ${scene.desc}`, function () {
      async function amountInMustGteAmountInDesired(longAmount, rateLongSwapback, shortAmount, rateShortSwapback, period, prefix = '( )') {
        const { accountB, accountA, txSignerA, txSignerB, weth, derivable1155, A_ID, B_ID, stateCalHelper } = await loadFixture(scene.scenerio);
        await txSignerA.swap(
          0x00,
          0x30,
          stateCalHelper.address,
          encodePayload(0, 0x00, 0x30, numberToWei(1)),
          0,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        const wethABegin = await weth.balanceOf(accountA.address)
        const wethBBegin = await weth.balanceOf(accountB.address)
        await txSignerA.swap(
          0x00,
          0x10,
          stateCalHelper.address,
          encodePayload(0, 0x00, 0x10, longAmount),
          0,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        await txSignerB.swap(
          0x00,
          0x20,
          stateCalHelper.address,
          encodePayload(0, 0x00, 0x20, shortAmount),
          0,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        );
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
        await txSignerA.swap(
          0x10,
          0x00,
          stateCalHelper.address,
          encodePayload(0, 0x10, 0x00, amountAIn),
          0,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        await txSignerB.swap(
          0x20,
          0x00,
          stateCalHelper.address,
          encodePayload(0, 0x20, 0x00, amountBIn),
          0,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        );
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