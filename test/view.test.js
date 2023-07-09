const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { ethers } = require("hardhat")
const { baseParams } = require("./shared/baseParams")
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { numberToWei, packId, swapToSetPriceV3 } = require("./shared/utilities")

describe("View", function () {
  const fixture = loadFixtureFromParams([baseParams], {
    callback: async function({derivablePools, uniswapPair}) {
      const pool = derivablePools[0]
      await pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(9995),
        0
      )

      const FlashloanAttack = await ethers.getContractFactory('FlashloanAttack');
      const flashloan = await FlashloanAttack.deploy(uniswapPair.address, pool.contract.address)

      return { flashloan }
    }
  })

  it("compute", async function () {
    const { owner, weth, usdc, derivablePools, derivable1155, flashloan } = await loadFixture(fixture)
    const pool = derivablePools[0]

    const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
    await pool.swap(
      SIDE_R,
      SIDE_B,
      numberToWei(1),
      0
    )
    
    const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
    const amountIn = tokenAfter.sub(tokenBefore)
    
    const { rA, sA, rB, sB, rC, sC } = await pool.contract.compute(derivable1155.address)

    const amountOut = await pool.swap(
      SIDE_B,
      SIDE_R,
      amountIn,
      0,
      { static: true }
    )

    expect(amountIn.mul(rB).div(sB)).equal(amountOut)
  })
})
