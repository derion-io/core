
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { SIDE_A, SIDE_R, SIDE_B } = require("./shared/constant");
const { scenerioBase } = require("./shared/scenerios");
const {_swap, _selectPrice} = require("./shared/AsymptoticPerpetual");
const { encodePayload, numberToWei, bn, weiToNumber } = require("./shared/utilities");

use(solidity)
const { AddressZero, MaxUint256 } = ethers.constants

const opts = {
  gasLimit: 30000000
}

describe("Open rate", function () {
  it("Buy long", async function () {
    const {oracleLibrary, derivable1155, stateCalHelper, derivablePool, owner, params} = await loadFixture(scenerioBase)
    const state = await derivablePool.getStates()
    const payload = encodePayload(0, SIDE_R, SIDE_A, numberToWei(1))
    const config = {
      INIT_TIME: params.initTime,
      HALF_LIFE: params.halfLife,
      K: params.k,
      MARK: params.mark
    }
    const oraclePrice = await oracleLibrary.fetch(params.oracle)
    const price = _selectPrice(
      config, 
      state, 
      {min: oraclePrice.spot, max: oraclePrice.twap}, 
      SIDE_R, 
      SIDE_A, 
      bn(await time.latest())
    )


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

    const state1 = await stateCalHelper.swapToState(price.market, state, price.rA, price.rB, payload)

    const amountOutWithoutOpenRate = (await _swap(
      SIDE_R,
      SIDE_A,
      derivable1155,
      derivablePool,
      state,
      state1,
      price
    )).amountOut
    expect(Number(weiToNumber(amountOut))/Number(weiToNumber(amountOutWithoutOpenRate)))
    .to.be.eq(0.9997)
  })

  it("Buy short", async function () {
    const {oracleLibrary, derivable1155, stateCalHelper, derivablePool, owner, params} = await loadFixture(scenerioBase)
    const state = await derivablePool.getStates()
    const payload = encodePayload(0, SIDE_R, SIDE_B, numberToWei(1))
    const config = {
      INIT_TIME: params.initTime,
      HALF_LIFE: params.halfLife,
      K: params.k,
      MARK: params.mark
    }
    const oraclePrice = await oracleLibrary.fetch(params.oracle)
    const price = _selectPrice(
      config, 
      state, 
      {min: oraclePrice.spot, max: oraclePrice.twap}, 
      SIDE_R, 
      SIDE_B, 
      bn(await time.latest())
    )


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

    const state1 = await stateCalHelper.swapToState(price.market, state, price.rA, price.rB, payload)

    const amountOutWithoutOpenRate = (await _swap(
      SIDE_R,
      SIDE_B,
      derivable1155,
      derivablePool,
      state,
      state1,
      price
    )).amountOut
    expect(Number(weiToNumber(amountOut))/Number(weiToNumber(amountOutWithoutOpenRate)))
    .to.be.eq(0.9997)
  })
})