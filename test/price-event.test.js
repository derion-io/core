const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { baseParams } = require("./shared/baseParams")
const { SIDE_R, SIDE_C, SIDE_B, SIDE_A } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { bn, numberToWei, swapToSetPriceMock } = require("./shared/utilities")
const { encodePriceSqrt } = require("./shared/utilities")


describe("Price selection", function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    premiumHL: bn(1).shl(128).div(2)
  }])

  async function testPriceSelection(sideIn, sideOut, spotPrice, twapPrice, isMax) {
    const {
      usdc,
      weth,
      derivablePools,
      uniswapPair,
      fetchPrice,
      params
    } = await loadFixture(fixture)
    const oracle = params[0].oracle
    const pool = derivablePools[0]

    await swapToSetPriceMock({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: twapPrice,
      targetSpot: spotPrice
    })
    const { spot, twap } = await fetchPrice.fetch(oracle)
    const txn = await pool.swap(
      sideIn,
      sideOut,
      bn(100000)
    )
    const {events} = await txn.wait()
    const swapEvent = events.find(x => x.event === 'Swap')
    const eventPrice = swapEvent.args['price']
    const max = twap.gt(spot) ? twap : spot
    const min = twap.gt(spot) ? spot : twap
    if (isMax) {
      expect(eventPrice).eq(max)
    } else {
      expect(eventPrice).eq(min)
    }
  }

  it("Price up; R->A", async function () {
    await testPriceSelection(SIDE_R, SIDE_A, 1600, 1500, true)
  })

  it("Price up; R->B", async function () {
    await testPriceSelection(SIDE_R, SIDE_B, 1600, 1500, false)
  })

  it("Price up; R->C", async function () {
    await testPriceSelection(SIDE_R, SIDE_C, 1600, 1500, false)
  })

  it("Price up; A->R", async function () {
    await testPriceSelection(SIDE_A, SIDE_R, 1600, 1500, false)
  })

  it("Price up; B->R", async function () {
    await testPriceSelection(SIDE_B, SIDE_R, 1600, 1500, true)
  })

  it("Price up; C->R", async function () {
    await testPriceSelection(SIDE_C, SIDE_R, 1600, 1500, true)
  })

  it("Price down; R->A", async function () {
    await testPriceSelection(SIDE_R, SIDE_A, 1500, 1600, true)
  })

  it("Price down; R->B", async function () {
    await testPriceSelection(SIDE_R, SIDE_B, 1500, 1600, false)
  })

  it("Price down; R->C", async function () {
    await testPriceSelection(SIDE_R, SIDE_C, 1500, 1600, false)
  })

  it("Price down; A->R", async function () {
    await testPriceSelection(SIDE_A, SIDE_R, 1500, 1600, false)
  })

  it("Price down; B->R", async function () {
    await testPriceSelection(SIDE_B, SIDE_R, 1500, 1600, true)
  })

  it("Price down; C->R", async function () {
    await testPriceSelection(SIDE_C, SIDE_R, 1500, 1600, true)
  })
})