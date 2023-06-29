const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_A, SIDE_B } = require("./shared/constant");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { bn, numberToWei } = require("./shared/utilities");
const abiCoder = new ethers.utils.AbiCoder()

use(solidity)

const SECONDS_PER_DAY = 86400
const MIN_EXPIRE = SECONDS_PER_DAY;
const DC = 50

function toHalfLife(dailyRate) {
  return dailyRate == 0 ? 0 : Math.round(SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate)))
}

describe("Premium and Future", function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    halfLife: bn(toHalfLife(0.006)),
    maturity: MIN_EXPIRE,
    discountRate: bn(DC).shl(128).div(100)
  }])

  it("Premium with future Long", async function () {
    const { derivablePools, accountA } = await loadFixture(fixture)

    const poolA = derivablePools[0].connect(accountA)
    await poolA.swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      await time.latest() + 365 * SECONDS_PER_DAY,
    )
  })

  it("Premium with future Short", async function () {
    const { derivablePools, accountA } = await loadFixture(fixture)

    const poolA = derivablePools[0].connect(accountA)
    await poolA.swap(
      SIDE_R,
      SIDE_B,
      numberToWei(1),
      await time.latest() + 365 * SECONDS_PER_DAY,
    )
  })

})
