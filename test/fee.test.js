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

function toDailyRate(HALF_LIFE) {
  return HALF_LIFE == 0 ? 0 : 1 - 2 ** (-SECONDS_PER_DAY / HALF_LIFE)
}

function toHalfLife(dailyRate) {
  return dailyRate == 0 ? 0 : SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate))
}

HLs.forEach(HALF_LIFE => {
  const dailyInterestRate = toDailyRate(HALF_LIFE)
  describe(`Interest rate fee: Interest rate ${dailyInterestRate}`, function () {
    const fixture = loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(HALF_LIFE)
    }], { feeRate: 12 })
      
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
        0
      )

      const feeAmount = await weth.balanceOf(feeReceiver.address)
      const interestRate = 1 - (1 - dailyInterestRate) ** period
      const feeRate = 1 - (1 - (dailyInterestRate / FEE_RATE)) ** period
      const pReservedAfterInterest = positionReserved.mul(((1 - interestRate) * 1e8).toFixed(0)).div(1e8)
      const actualFeeRate = Number(weiToNumber(feeAmount)) / Number(weiToNumber(pReservedAfterInterest))

      expect(feeRate / actualFeeRate).to.be.closeTo(1, 0.1)
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