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


describe("Price selection", async function () {
  const fixture = await loadFixtureFromParams([{
    ...baseParams,
    premiumHL: bn(1).shl(128).div(2)
  }])

  async function testPriceSelection(targetPrice, sideIn, sideOut) {
    const {
      usdc,
      weth,
      derivablePools,
      uniswapPair
    } = await loadFixture(fixture)

    const pool = derivablePools[0]

    // twap = spot = 1500
    const firstOut = await pool.swap(
      sideIn,
      sideOut,
      numberToWei(0.1),
      {static: true}
    )

    // twap = spot = targetPrice
    await swapToSetPriceMock({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: targetPrice,
      targetSpot: targetPrice
    })
    const secondOut = await pool.swap(
      sideIn,
      sideOut,
      numberToWei(0.1),
      {static: true}
    )

    // twap = targetPrice, spot = 1500
    await swapToSetPriceMock({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: targetPrice,
      targetSpot: 1500
    })
    const thirdOut = await pool.swap(
      sideIn,
      sideOut,
      numberToWei(0.1),
      {static: true}
    )

    // twap = 1500, spot = targetPrice
    await swapToSetPriceMock({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: 1500,
      targetSpot: targetPrice
    })
    const fourthOut = await pool.swap(
      sideIn,
      sideOut,
      numberToWei(0.1),
      {static: true}
    )
    
    const min = firstOut.lte(secondOut) ? firstOut : secondOut
    expect(min).to.be.equal(thirdOut)
    expect(min).to.be.equal(fourthOut)
  }

  it("Price up; R->A", async function () {
    await testPriceSelection(1700, SIDE_R, SIDE_A)
  })

  it("Price up; R->B", async function () {
    await testPriceSelection(1700, SIDE_R, SIDE_B)
  })

  it("Price up; R->C", async function () {
    await testPriceSelection(1700, SIDE_R, SIDE_C)
  })

  it("Price up; A->R", async function () {
    await testPriceSelection(1700, SIDE_A, SIDE_R)
  })

  it("Price up; B->R", async function () {
    await testPriceSelection(1700, SIDE_B, SIDE_R)
  })

  it("Price up; C->R", async function () {
    await testPriceSelection(1700, SIDE_C, SIDE_R)
  })

  it("Price down; R->A", async function () {
    await testPriceSelection(1300, SIDE_R, SIDE_A)
  })

  it("Price down; R->B", async function () {
    await testPriceSelection(1300, SIDE_R, SIDE_B)
  })

  it("Price down; R->C", async function () {
    await testPriceSelection(1300, SIDE_R, SIDE_C)
  })

  it("Price down; A->R", async function () {
    await testPriceSelection(1300, SIDE_A, SIDE_R)
  })

  it("Price down; B->R", async function () {
    await testPriceSelection(1300, SIDE_B, SIDE_R)
  })

  it("Price down; C->R", async function () {
    await testPriceSelection(1300, SIDE_C, SIDE_R)
  })
})