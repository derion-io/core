
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { SIDE_A, SIDE_R, SIDE_B, SIDE_C } = require("./shared/constant");
const { scenerioBase, getOpenFeeScenerios } = require("./shared/scenerios");
const {_swap, _selectPrice} = require("./shared/AsymptoticPerpetual");
const { encodePayload, numberToWei, bn, weiToNumber } = require("./shared/utilities");

use(solidity)
const { AddressZero, MaxUint256 } = ethers.constants

const opts = {
  gasLimit: 30000000
}

const feeRates = [0.03, 0.005, 0.95, 0.999, 1] 

feeRates.forEach(feeRate => {
  describe(`Open rate ${feeRate}`, function () {
    it("Buy long", async function () {
      const {stateCalHelper, derivablePool, owner, poolWithOpenFee} = await loadFixture(getOpenFeeScenerios(feeRate))
      const payload = encodePayload(0, SIDE_R, SIDE_A, numberToWei(1))
  
      const amountOut = (await derivablePool.callStatic.swap(
        SIDE_R,
        SIDE_A,
        stateCalHelper.address,
        payload,
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut

  
      const amountOutWithFee = (await poolWithOpenFee.callStatic.swap(
        SIDE_R,
        SIDE_A,
        stateCalHelper.address,
        payload,
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut
      expect(Number(weiToNumber(amountOutWithFee))/Number(weiToNumber(amountOut)))
      .to.be.closeTo(1- feeRate, 1e10)
    })
  
    it("Buy short", async function () {
      const {stateCalHelper, derivablePool, owner, poolWithOpenFee} = await loadFixture(getOpenFeeScenerios(feeRate))
      const payload = encodePayload(0, SIDE_R, SIDE_B, numberToWei(1))
  
      const amountOut = (await derivablePool.callStatic.swap(
        SIDE_R,
        SIDE_B,
        stateCalHelper.address,
        payload,
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut
  
      const amountOutWithFee = (await poolWithOpenFee.callStatic.swap(
        SIDE_R,
        SIDE_B,
        stateCalHelper.address,
        payload,
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut
      expect(Number(weiToNumber(amountOutWithFee))/Number(weiToNumber(amountOut)))
      .to.be.closeTo(1- feeRate, 1e10)
    })

    it("LP should increase value after open position", async function () {
      const {stateCalHelper, derivable1155, owner, poolWithOpenFee} = await loadFixture(getOpenFeeScenerios(feeRate))
      await derivable1155.setApprovalForAll(poolWithOpenFee.address, true)
      const amountOutLP = (await poolWithOpenFee.callStatic.swap(
        SIDE_C,
        SIDE_R,
        stateCalHelper.address,
        encodePayload(0, SIDE_C, SIDE_R, '1000'),
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut

      await poolWithOpenFee.swap(
        SIDE_R,
        SIDE_A,
        stateCalHelper.address,
        encodePayload(0, SIDE_R, SIDE_A, numberToWei(1)),
        0,
        AddressZero,
        owner.address,
        opts
      )

      const amountOutLP1 = (await poolWithOpenFee.callStatic.swap(
        SIDE_C,
        SIDE_R,
        stateCalHelper.address,
        encodePayload(0, SIDE_C, SIDE_R, '1000'),
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut
  
      await poolWithOpenFee.swap(
        SIDE_R,
        SIDE_B,
        stateCalHelper.address,
        encodePayload(0, SIDE_R, SIDE_B, numberToWei(1)),
        0,
        AddressZero,
        owner.address,
        opts
      )
      
      const amountOutLP2 = (await poolWithOpenFee.callStatic.swap(
        SIDE_C,
        SIDE_R,
        stateCalHelper.address,
        encodePayload(0, SIDE_C, SIDE_R, '1000'),
        0,
        AddressZero,
        owner.address,
        opts
      )).amountOut

      expect(amountOutLP2).to.be.gt(amountOutLP1)
      expect(amountOutLP1).to.be.gt(amountOutLP)
    })
  })
})
