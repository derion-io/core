const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { ethers } = require("hardhat");
const { _selectPrice, _evaluate } = require("./shared/AsymptoticPerpetual");
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant");
const { weiToNumber, bn, numberToWei, paramToConfig } = require("./shared/utilities");
const { AddressZero } = require("@ethersproject/constants");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { baseParams } = require("./shared/baseParams");

use(solidity)

const SECONDS_PER_DAY = 86400

const HLs = [19932680, 1966168] // 0.3%, 3%

const FEE_RATE = 12

function toDailyRate(HALF_LIFE, precision = 4) {
  if (HALF_LIFE == 0) {
    return 0
  }
  const rate = 1 - 2 ** (-SECONDS_PER_DAY / HALF_LIFE)
  return Math.round(rate * 10**precision) / 10**precision
}

function toHalfLife(dailyRate) {
  return Math.round(dailyRate == 0 ? 0 : SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate)))
}

HLs.forEach(HALF_LIFE => {
  const dailyInterestRate = toDailyRate(HALF_LIFE)
  describe(`Interest rate fee: Interest rate ${dailyInterestRate*100}%, Fee rate ${FEE_RATE}`, async function () {
    const fixture = await loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(HALF_LIFE)
    }], { feeRate: FEE_RATE })
      
    async function getFeeFromSwap(side, amount, period) {
      const { derivablePools, oracleLibrary, params, feeReceiver, weth } = await loadFixture(fixture)

      const pool = derivablePools[0]
      const config = paramToConfig(params[0])
      const state = await pool.contract.getStates()
      const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
      const price = _selectPrice(
        config,
        state,
        { min: oraclePrice.spot, max: oraclePrice.twap },
        0x00,
        0x20,
        bn(await time.latest())
      )

      const eval = _evaluate(price.market, state)
      const positionReserved = eval.rA.add(eval.rB)

      await time.increase(period * SECONDS_PER_DAY);

      await pool.swap(
        SIDE_R,
        side,
        numberToWei(amount),
      )

      const actualFee = await weth.balanceOf(feeReceiver.address)
      const interestRate = 1 - (1 - dailyInterestRate) ** period
      const interest = positionReserved.mul((interestRate* 1e8).toFixed(0)).div(1e8)
      const feeRate = interest.mul(1e6).div(actualFee).toNumber() / 1e6

      expect(feeRate / FEE_RATE).to.be.closeTo(1, 0.0001)
    }

    it("Charge fee: Open 0.1e Long - period 1 day", async function () {
      await getFeeFromSwap(SIDE_A, 0.1, 1)
    })

    it("Charge fee: Open 1e Long - period 10 day", async function () {
      await getFeeFromSwap(SIDE_A, 1, 10)
    })

    it("Charge fee: Open 5e Long - period 100 day", async function () {
      await getFeeFromSwap(SIDE_A, 5, 100)
    })

    it("Charge fee: Open 1e Long - period 365 day", async function () {
      await getFeeFromSwap(SIDE_A, 1, 365)
    })

    it("Charge fee: Open 0.1e Short - period 1 day", async function () {
      await getFeeFromSwap(SIDE_B, 0.1, 1)
    })

    it("Charge fee: Open 1e Short - period 10 day", async function () {
      await getFeeFromSwap(SIDE_B, 1, 10)
    })

    it("Charge fee: Open 5e Short - period 100 day", async function () {
      await getFeeFromSwap(SIDE_B, 5, 100)
    })

    it("Charge fee: Open 1e Short - period 365 day", async function () {
      await getFeeFromSwap(SIDE_B, 1, 365)
    })

    it("Charge fee: Open 0.1e LP - period 1 day", async function () {
      await getFeeFromSwap(SIDE_C, 0.1, 1)
    })

    it("Charge fee: Open 1e LP - period 10 day", async function () {
      await getFeeFromSwap(SIDE_C, 1, 10)
    })

    it("Charge fee: Open 5e LP - period 100 day", async function () {
      await getFeeFromSwap(SIDE_C, 5, 100)
    })

    it("Charge fee: Open 1e LP - period 365 day", async function () {
      await getFeeFromSwap(SIDE_C, 1, 365)
    })
  })

  describe(`Interest rate fee: Interest rate ${dailyInterestRate*100}%, Fee rate ${numberToWei(10000)}`, async function () {
    const fixture = await loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(HALF_LIFE)
    }], { feeRate: numberToWei(10000) })
    
    it('Fee should be zero', async function() {
      const { derivablePools, feeReceiver, weth } = await loadFixture(fixture)

      const pool = derivablePools[0]

      await time.increase(365 * SECONDS_PER_DAY);

      await pool.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(1),
      )

      const actualFee = await weth.balanceOf(feeReceiver.address)

      expect(actualFee).to.be.eq(0)
    })
  })

  const dailyPremiumRate = 0.1
  describe(`Interest rate ${dailyInterestRate*100}% - Premium rate ${dailyPremiumRate*100}% - Fee rate ${FEE_RATE}`, async function () {
    const fixture = await loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(HALF_LIFE),
      premiumHL: bn(toHalfLife(dailyPremiumRate))
    }], { 
      feeRate: FEE_RATE,
      logicName: 'View'
    })

    it('Fee for all', async function() {
      const { derivablePools, derivable1155, feeReceiver, weth } = await loadFixture(fixture)

      const pool = derivablePools[0]
      const UNIT = 10000

      await pool.swap(
        SIDE_R,
        SIDE_A,
        numberToWei(1),
      )

      const {rA, rB, state} = await pool.contract.callStatic.compute(derivable1155.address, FEE_RATE, 0, 0)

      const interestRate = Math.round(((1 - dailyInterestRate)**365)*UNIT)/UNIT

      const rAAfter = rA.mul(Math.round(UNIT * interestRate)).div(UNIT)
      const rBAfter = rB.mul(Math.round(UNIT * interestRate)).div(UNIT)
      const interest = rA.add(rB).sub(rAAfter).sub(rBAfter)

      const premiumRate = Math.round((1 - (1 - dailyPremiumRate)**365)*UNIT)/UNIT
      let premium = rAAfter.gt(rBAfter) ? rAAfter.sub(rBAfter) : rBAfter.sub(rAAfter)
      premium = premium.div(2).mul(rA.add(rB)).div(state.R)
      premium = premium.mul(Math.round(UNIT * premiumRate)).div(UNIT)

      const expectedFee = Number(weiToNumber(interest.add(premium).div(FEE_RATE)))
      
      const balanceBefore = await weth.balanceOf(feeReceiver.address)

      await time.increase(365 * SECONDS_PER_DAY);

      await pool.swap(
        SIDE_R,
        SIDE_A,
        bn(1),
      )

      const actualFee = Number(weiToNumber((await weth.balanceOf(feeReceiver.address)).sub(balanceBefore)))
      expect(actualFee/expectedFee).to.closeTo(1, 0.05)
    })
  })
})

describe("FeeReceiver", function() {
  async function fixture() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;

    // deploy fee receiver
    const FeeReceiver = await ethers.getContractFactory("FeeReceiver")
    const feeReceiver = await FeeReceiver.deploy(owner.address)
    await feeReceiver.deployed()

    // erc20 factory
    const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
    const usdc = await erc20Factory.deploy(numberToWei(100000000000));

    return {
      owner, 
      accountA,
      accountB,
      feeReceiver,
      usdc
    }
  }

  it("Can be received native token", async function() {
    const {owner, feeReceiver} = await loadFixture(fixture)
    const tx = {
      to: feeReceiver.address,
      value: numberToWei(1)
    };
    const transaction = await owner.sendTransaction(tx);
    transaction.wait()
  })
  it("Only setter can set collector", async function() {
    const {accountA, feeReceiver} = await loadFixture(fixture)
    await expect(feeReceiver.connect(accountA).setCollector(accountA.address))
    .to.be.revertedWith('FeeReciever: NOT_SETTER')
    await feeReceiver.setCollector(accountA.address)
    expect(await feeReceiver.getCollector()).to.be.eq(accountA.address)
  })
  it("Only setter can set setter", async function() {
    const {accountA, feeReceiver} = await loadFixture(fixture)
    await expect(feeReceiver.connect(accountA).setCollector(accountA.address))
    .to.be.revertedWith('FeeReciever: NOT_SETTER')
    await feeReceiver.setSetter(accountA.address)
    expect(await feeReceiver.getSetter()).to.be.eq(accountA.address)
  })
  it("Only collector can collect", async function() {
    const {accountA, accountB, owner, feeReceiver, usdc} = await loadFixture(fixture)
    await feeReceiver.setCollector(owner.address)
    await expect(feeReceiver.connect(accountA).collect(
      AddressZero,
      accountA.address,
      1
    ))
    .to.be.revertedWith('FeeReciever: NOT_COLLECTOR')
    
    await usdc.transfer(feeReceiver.address, 100)
    const tx = {
      to: feeReceiver.address,
      value: 100
    };
    const transaction = await owner.sendTransaction(tx);
    await transaction.wait()

    const ethBalanceBefore = await accountB.getBalance()
    const usdcBefore = await usdc.balanceOf(accountB.address)
    await feeReceiver.collect(
      AddressZero,
      accountB.address,
      1
    )
    await feeReceiver.collect(
      usdc.address,
      accountB.address,
      1
    )
    const ethBalanceAfter = await accountB.getBalance()
    const usdcAfter = await usdc.balanceOf(accountB.address)
    expect(usdcAfter.sub(usdcBefore)).to.be.eq(1)
    expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.eq(1)
  })
})