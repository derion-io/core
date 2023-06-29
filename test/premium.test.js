const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { _evaluate, _selectPrice, _init, _xk, _r } = require("./shared/AsymptoticPerpetual");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_A, SIDE_B, Q256M } = require("./shared/constant");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload, attemptSwap, attemptStaticSwap, feeToOpenRate, paramToConfig } = require("./shared/utilities");
const abiCoder = new ethers.utils.AbiCoder()
use(solidity)

const HALF_LIFE = 0;

const pe = (x) => ethers.utils.parseEther(String(x))

describe("Premium", function () {
  const fixture = loadFixtureFromParams([
    baseParams, 
    {
      ...baseParams,
      premiumRate: bn(1).shl(128).div(2)
    }
  ])

  async function premiumAppliedLongBuyShort(amount) {
    const {derivablePools, accountA, accountB} = await loadFixture(fixture)
    const poolNoPremium = derivablePools[0]
    const pool = derivablePools[1]
    await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    // await attemptSwap(
    //   txSignerA,
    //   0,
    //   0x00,
    //   0x10,
    //   numberToWei(1),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    // await attemptSwap(
    //   txSignerANoPremium,
    //   0,
    //   0x00,
    //   0x10,
    //   numberToWei(1),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    const shortWithPremium = await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(amount),
      0,
      { static: true }
    )

    // const shortWithPremium = await attemptStaticSwap(
    //   txSignerA,
    //   0,
    //   0x00,
    //   0x20,
    //   numberToWei(amount),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    const shortWithoutPremium = await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(amount),
      0,
      { static: true }
    )
    // const shortWithoutPremium = await attemptStaticSwap(
    //   txSignerANoPremium,
    //   0,
    //   0x00,
    //   0x20,
    //   numberToWei(amount),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    expect(shortWithPremium)
      .to.be.equal(shortWithoutPremium)
  }

  async function premiumAppliedShortBuyLong(amount) {
    const {derivablePools, accountA, accountB} = await loadFixture(fixture)
    const poolNoPremium = derivablePools[0]
    const pool = derivablePools[1]

    await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(1),
      0
    )
    // await attemptSwap(
    //   txSignerA,
    //   0,
    //   0x00,
    //   0x20,
    //   numberToWei(1),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(1),
      0
    )
    // await attemptSwap(
    //   txSignerANoPremium,
    //   0,
    //   0x00,
    //   0x20,
    //   numberToWei(1),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    const longWithPremium = await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(amount),
      0,
      { static: true }
    )

    // const longWithPremium = await attemptStaticSwap(
    //   txSignerA,
    //   0,
    //   0x00,
    //   0x10,
    //   numberToWei(amount),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    const longWithoutPremium = await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(amount),
      0,
      { static: true }
    )

    // const longWithoutPremium = await attemptStaticSwap(
    //   txSignerANoPremium,
    //   0,
    //   0x00,
    //   0x10,
    //   numberToWei(amount),
    //   stateCalHelper.address,
    //   '0x0000000000000000000000000000000000000000',
    //   accountA.address
    // )

    expect(longWithPremium).to.be.equal(longWithoutPremium)
  }

  async function premiumBuyingLong(amount) {
    const { derivablePools, accountA, oracleLibrary, params } = await loadFixture(fixture)
    const poolNoPremium = derivablePools[0]
    const pool = derivablePools[1]
    const config = paramToConfig(params[0])

    const state = await pool.contract.getStates()
    const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
    
    const xk = _xk(oraclePrice.twap, config.K, config.MARK)
    const rA = _r(xk, state.a, state.R)
    const rB = _r(Q256M.div(xk), state.b, state.R)
    
    const rA1 = rA.add(numberToWei(amount));
    const rB1 = rB;
    const R = state.R.add(numberToWei(amount));
    const rC1 = R.sub(rA).sub(rB);
    const imbalanceRate = rA1.sub(rB1).mul(bn(1).shl(128)).div(rC1)

    const longWithPremium = await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(amount),
      0,
      { static: true }
    )

    const longWithoutPremium = await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(amount),
      0,
      { static: true }
    )

    expect(longWithPremium, "premium taken").lt(longWithoutPremium)
    expect(longWithPremium, "premium taken").gte(
      longWithoutPremium.mul(config.PREMIUM_RATE).div(imbalanceRate).sub(20)
    )
    if (amount <= 1)
      expect(Number(weiToNumber(longWithPremium.mul(imbalanceRate).div(config.PREMIUM_RATE))))
        .to.be.closeTo(
          Number(weiToNumber(longWithoutPremium)), 0.00001
        )
  }

  async function premiumBuyingShort(amount) {
    const { derivablePools, accountA, oracleLibrary, params } = await loadFixture(fixture)
    const poolNoPremium = derivablePools[0]
    const pool = derivablePools[1]
    const config = paramToConfig(params[0])

    const state = await pool.contract.getStates()
    const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
    
    const xk = _xk(oraclePrice.twap, config.K, config.MARK)
    const rA = _r(xk, state.a, state.R)
    const rB = _r(Q256M.div(xk), state.b, state.R)
    
    const rA1 = rA;
    const rB1 = rB.add(numberToWei(amount));
    const R = state.R.add(numberToWei(amount));
    const rC1 = R.sub(rA).sub(rB);
    const imbalanceRate = rB1.sub(rA1).mul(bn(1).shl(128)).div(rC1)

    const shortWithPremium = await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(amount),
      0,
      { static: true }
    )

    const shortWithoutPremium = await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(amount),
      0,
      { static: true }
    )

    expect(shortWithPremium, "premium taken").lt(shortWithoutPremium)
    expect(shortWithPremium, "premium taken").gte(
      shortWithoutPremium.mul(config.PREMIUM_RATE).div(imbalanceRate).sub(20)
    )
    if (amount <= 1)
      expect(Number(weiToNumber(shortWithPremium.mul(imbalanceRate).div(config.PREMIUM_RATE))))
        .to.be.closeTo(
          Number(weiToNumber(shortWithoutPremium)), 0.00001
        )
  }

  it("RiskFactor > PremiumRate: Buy long 1.7e", async function () {
    await premiumBuyingLong(1.7)
  })

  it("RiskFactor > PremiumRate: Buy long 3e", async function () {
    await premiumBuyingLong(3)
  })

  it("RiskFactor > PremiumRate: Buy long 2e", async function () {
    await premiumBuyingLong(2)
  })

  it("RiskFactor > PremiumRate: Buy short 0.1e", async function () {
    await premiumAppliedLongBuyShort(0.1)
  })

  it("RiskFactor ≤ PremiumRate: Buy long 0.1e", async function () {
    const { derivablePools, accountA } = await loadFixture(fixture)
    const poolNoPremium = derivablePools[0]
    const pool = derivablePools[1]
    const withPremium = await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(0.1),
      0,
      { static: true }
    )

    const withoutPremium = await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(0.1),
      0,
      { static: true }
    )

    expect(withPremium)
      .to.be.equal(withoutPremium)
  })

  it("RiskFactor ≥ -PremiumRate: Buy short 0.1e", async function () {
    const { derivablePools, accountA } = await loadFixture(fixture)
    const poolNoPremium = derivablePools[0]
    const pool = derivablePools[1]
    const withPremium = await pool.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(0.1),
      0,
      { static: true }
    )

    const withoutPremium = await poolNoPremium.connect(accountA).swap(
      SIDE_R,
      SIDE_B,
      numberToWei(0.1),
      0,
      { static: true }
    )

    expect(withPremium)
      .to.be.equal(withoutPremium)
  })

  it("RiskFactor < -PremiumRate: Buy short 3e", async function () {
    await premiumBuyingShort(3)
  })

  it("RiskFactor < -PremiumRate: Buy short 1.7e", async function () {
    await premiumBuyingShort(1.7)
  })

  it("RiskFactor < -PremiumRate: Buy short 2e", async function () {
    await premiumBuyingShort(2)
  })

  it("RiskFactor < -PremiumRate: Buy long 0.1e", async function () {
    await premiumAppliedShortBuyLong(0.1)
  })
})
