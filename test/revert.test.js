const {
  loadFixture, time,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { ethers } = require("hardhat")
const { baseParams } = require("./shared/baseParams")
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const { AddressZero, MaxUint256 } = ethers.constants
const expect = chai.expect
const { numberToWei, packId, bn } = require("./shared/utilities")

const pe = (x) => ethers.utils.parseEther(String(x))

const HALF_LIFE = 10 * 365 * 24 * 60 * 60
const PAYMENT = 0

describe("Revert", function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    halfLife: bn(HALF_LIFE),
    premiumHL: bn(1).shl(128).div(2),
  }, {
    ...baseParams,
    halfLife: bn(HALF_LIFE),
    premiumHL: bn(1).shl(128).div(2),
    maturity: 60,
    maturityVest: Math.floor(60 / 1),
    maturityRate: bn(1 * 1000).shl(128).div(1000),
  }], {
    callback: async function ({ derivablePools, weth, derivable1155 }) {
      const pool = derivablePools[0]
      // deploy FakeUTR
      const FakeUTR = await ethers.getContractFactory("contracts/test/FakeUTR.sol:FakeUTR")
      const fakeUTR = await FakeUTR.deploy()

      // deploy ReentrancyAttack
      const ReentrancyAttack = await ethers.getContractFactory("contracts/test/ReentrancyAttack.sol:ReentrancyAttack")
      const reentrancyAttack = await ReentrancyAttack.deploy(
        pool.contract.address,
        weth.address
      )

      // deploy bad helper
      const BadHelper2 = await ethers.getContractFactory("BadHelper2")
      const badHelperOA = await BadHelper2.deploy(
          derivable1155.address,
          weth.address
      )
      await badHelperOA.deployed()

      const BadHelper3 = await ethers.getContractFactory("BadHelper3")
      const badHelperOB = await BadHelper3.deploy(
          derivable1155.address,
          weth.address
      )
      await badHelperOB.deployed()

      return {
        fakeUTR,
        reentrancyAttack,
        badHelperOA,
        badHelperOB
      }
    }
  })

  function convertId(side, poolAddress) {
    switch (side) {
      case SIDE_R:
        return packId(SIDE_R, poolAddress)
      case SIDE_A:
        return packId(SIDE_A, poolAddress)
      case SIDE_B:
        return packId(SIDE_B, poolAddress)
      case SIDE_C:
        return packId(SIDE_C, poolAddress)
      default:
        return 0
    }
  }

  describe("PoolBase", function () {
    it("init: ZERO_PARAM, INVALID_PARAM, INSUFFICIENT_PAYMENT, ALREADY_INITIALIZED", async function () {
      const { owner, weth, utr, params, poolFactory, derivable1155, fakeUTR } = await loadFixture(fixture)
      const config = {
        FETCHER: params[1].fetcher,
        ORACLE: params[1].oracle,
        TOKEN_R: params[1].reserveToken,
        MARK: params[1].mark,
        K: bn(6),
        INTEREST_HL: params[1].halfLife,
        PREMIUM_HL: params[1].premiumHL,
        MATURITY: params[1].maturity,
        MATURITY_VEST: params[1].maturityVest,
        MATURITY_RATE: params[1].maturityRate,
        OPEN_RATE: params[1].openRate,
      }
      const tx = await poolFactory.createPool(config)
      const receipt = await tx.wait()
      const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
      expect(await derivable1155.balanceOf(owner.address, convertId(SIDE_A, poolAddress))).equal(0)
      const initParams = {
        R: numberToWei(5),
        a: numberToWei(1),
        b: numberToWei(1),
      }
      const payment = {
        utr: utr.address,
        payer: owner.address,
        recipient: owner.address,
      }
      const pool = await ethers.getContractAt("PoolBase", poolAddress)
      // Revert ZERO_PARAM
      await expect(pool.callStatic.init(
        {
          R: numberToWei(5),
          a: numberToWei(0),
          b: numberToWei(1),
        },
        payment
      )).to.be.revertedWith("ZERO_PARAM")
      // Revert INVALID_PARAM
      await expect(pool.callStatic.init(
        {
          R: numberToWei(5),
          a: numberToWei(6),
          b: numberToWei(1),
        },
        payment
      )).to.be.revertedWith("INVALID_PARAM")
      // Revert INSUFFICIENT_PAYMENT
      await weth.approve(fakeUTR.address, MaxUint256)
      await expect(fakeUTR.exec([],
        [{
          inputs: [{
            mode: PAYMENT,
            eip: 20,
            token: weth.address,
            id: 0,
            amountIn: numberToWei(5),
            recipient: poolAddress,
          }],
          flags: 0,
          code: poolAddress,
          data: (await pool.populateTransaction.init(
            initParams,
            {
              utr: fakeUTR.address,
              payer: owner.address,
              recipient: owner.address,
            }
          )).data,
        }])).to.be.revertedWith("INSUFFICIENT_PAYMENT")
      // Normal case
      await weth.approve(utr.address, MaxUint256)
      await utr.exec([],
        [{
          inputs: [{
            mode: PAYMENT,
            eip: 20,
            token: weth.address,
            id: 0,
            amountIn: numberToWei(5),
            recipient: poolAddress,
          }],
          flags: 0,
          code: poolAddress,
          data: (await pool.populateTransaction.init(
            initParams,
            payment
          )).data,
        }])
      expect(await derivable1155.balanceOf(owner.address, convertId(SIDE_A, poolAddress))).gt(0)
      // Revert ALREADY_INITIALIZED
      await expect(pool.init(
        initParams,
        payment
      )).to.be.revertedWith("ALREADY_INITIALIZED")
    })

    it("swap: STATE_INTEGRITY", async function () {
      const { stateCalHelper, derivablePools, accountA, reentrancyAttack, weth, utr, owner } = await loadFixture(fixture)
      const pool = derivablePools[1]
      // await expect(pool.swap(
      //   SIDE_R,
      //   SIDE_A,
      //   numberToWei(5),
      //   {
      //     recipient: accountA.address
      //   }
      // )).to.be.revertedWith("MM")

      // await expect(pool.swap(
      //   SIDE_R,
      //   SIDE_A,
      //   numberToWei(5),
      //   {
      //     recipient: accountA.address
      //   }
      // )).to.be.revertedWith("MO")

      // Revert STATE_INTEGRITY
      const swapParams = {
        sideIn: 0,
        sideOut: 48,
        maturity: 0,
        helper: stateCalHelper.address,
        payload: '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000004563918244f400000000000000000000000000000000000080000000000000000000000000000000'
      }
      const paymentParams = {
        utr: utr.address,
        payer: AddressZero,
        recipient: reentrancyAttack.address
      }
      await weth.transfer(reentrancyAttack.address, numberToWei(5))
      await expect(reentrancyAttack.attack(
        numberToWei(5),
        swapParams,
        paymentParams
      )).to.be.revertedWith("STATE_INTEGRITY")
    })

    it("Swap: INSUFFICIENT_PAYMENT", async function () {
      const { weth, derivablePools, derivable1155, fakeUTR, owner } = await loadFixture(fixture)
      await derivable1155.setApprovalForAll(fakeUTR.address, true);
      const pool = derivablePools[0]
      await weth.approve(fakeUTR.address, MaxUint256)
      await expect(fakeUTR.exec([], [{
        inputs: [{
            mode: PAYMENT,
            eip: 20,
            token: weth.address,
            id: 0,
            amountIn: 1000,
            recipient: pool.contract.address,
        }],
        code: pool.contract.address,
        data: (await pool.swap(
          SIDE_R,
          SIDE_C,
          1000, {
            populateTransaction: true,
            payer: owner.address,
            utr: fakeUTR.address
          }
        )).data,
      }])).to.be.revertedWith("INSUFFICIENT_PAYMENT")

      await expect(fakeUTR.exec([], [{
        inputs: [{
            mode: PAYMENT,
            eip: 1155,
            token: derivable1155.address,
            id: packId(SIDE_A, pool.contract.address),
            amountIn: 1000,
            recipient: pool.contract.address,
        }],
        code: pool.contract.address,
        data: (await pool.swap(
          SIDE_A,
          SIDE_R,
          1000, {
            populateTransaction: true,
            payer: owner.address,
            utr: fakeUTR.address
          }
        )).data,
      }])).to.be.revertedWith("INSUFFICIENT_PAYMENT")
    })
  })

  describe("PoolFactory", function () {
    it("createPool", async function () {
      const { params, poolFactory } = await loadFixture(fixture)
      const config = {
        FETCHER: params[1].fetcher,
        ORACLE: params[1].oracle,
        TOKEN_R: params[1].reserveToken,
        MARK: params[1].mark,
        K: bn(5),
        INTEREST_HL: params[1].halfLife,
        PREMIUM_HL: params[1].premiumHL,
        MATURITY: params[1].maturity,
        MATURITY_VEST: params[1].maturityVest,
        MATURITY_RATE: params[1].maturityRate,
        OPEN_RATE: params[1].openRate,
      }
      await expect(poolFactory.createPool(config)).to.be.revertedWith("PoolFactory: CREATE2_FAILED")
    })
  })

  describe("PoolLogic", function () {
    it("_swap: SAME_SIDE, STATE1_OVERFLOW_A, STATE1_OVERFLOW_B, INVALID_SIDE_IN, INVALID_SIDE_OUT", async function () {
      const { derivablePools, badHelperOA, badHelperOB } = await loadFixture(fixture)
      const pool = derivablePools[0]
      await expect(pool.swap(
        SIDE_R,
        SIDE_R,
        numberToWei(5),
      )).to.be.revertedWith("SAME_SIDE")

      await expect(pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(5),
        {
          helper: badHelperOA.address
        }
      )).to.be.revertedWith("STATE1_OVERFLOW_A")

      await expect(pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(5),
        {
          helper: badHelperOB.address
        }
      )).to.be.revertedWith("STATE1_OVERFLOW_B")

      const SIDE_D = 0x40
      await expect(pool.swap(
        SIDE_R,
        SIDE_D,
        numberToWei(5),
      )).to.be.revertedWith("INVALID_SIDE_OUT")
      await expect(pool.swap(
        SIDE_D,
        SIDE_R,
        numberToWei(5),
      )).to.be.revertedWith("INVALID_SIDE_IN")
    })

    it("_swap: MINIMUM_SUPPLY, MINIMUM_RESERVE_C, MINIMUM_RESERVE_A, MINIMUM_RESERVE_B", async function () {
      const { owner, weth, utr, params, poolFactory, derivable1155, stateCalHelper } = await loadFixture(fixture)
      const SECONDS_PER_DAY = 60 * 60 * 24
      const dailyFundingRate = (0.0000000002 * 6) / 100
      const halfLife = Math.round(
        SECONDS_PER_DAY /
        Math.log2(1 / (1 - dailyFundingRate)))
      const config = {
        FETCHER: AddressZero,
        ORACLE: params[0].oracle,
        TOKEN_R: params[0].reserveToken,
        MARK: params[0].mark,
        K: bn(6),
        INTEREST_HL: halfLife,
        PREMIUM_HL: params[0].premiumHL,
        MATURITY: params[0].maturity,
        MATURITY_VEST: params[0].maturityVest,
        MATURITY_RATE: params[0].maturityRate,
        OPEN_RATE: params[0].openRate,
      }
      const tx = await poolFactory.createPool(config)
      const receipt = await tx.wait()
      const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
      const initParams = {
        R: 500,
        a: 200,
        b: 200,
      }
      const payment = {
        utr: utr.address,
        payer: owner.address,
        recipient: owner.address,
      }
      const poolBase = await ethers.getContractAt("PoolBase", poolAddress)
      await weth.approve(utr.address, MaxUint256);
      await utr.exec([],
        [{
          inputs: [{
            mode: PAYMENT,
            eip: 20,
            token: weth.address,
            id: 0,
            amountIn: 5000,
            recipient: poolAddress,
          }],
          flags: 0,
          code: poolAddress,
          data: (await poolBase.populateTransaction.init(
            initParams,
            payment
          )).data,
        }])

      await expect(utr.exec([], [{
        inputs: [{
          mode: PAYMENT,
          eip: 20,
          token: weth.address,
          id: 0,
          amountIn: 50,
          recipient: poolAddress,
        }],
        code: stateCalHelper.address,
        data: (await stateCalHelper.populateTransaction.swap({
          sideIn: SIDE_A,
          poolIn: poolAddress,
          sideOut: SIDE_R,
          poolOut: poolAddress,
          amountIn: 50,
          payer: owner.address,
          recipient: owner.address,
          INDEX_R: 0
        })).data,
      }])).to.be.revertedWith("MINIMUM_SUPPLY")

      await expect(utr.exec([], [{
        inputs: [{
          mode: PAYMENT,
          eip: 20,
          token: weth.address,
          id: 0,
          amountIn: 50,
          recipient: poolAddress,
        }],
        code: stateCalHelper.address,
        data: (await stateCalHelper.populateTransaction.swap({
          sideIn: SIDE_R,
          poolIn: poolAddress,
          sideOut: SIDE_C,
          poolOut: poolAddress,
          amountIn: 50,
          payer: owner.address,
          recipient: owner.address,
          INDEX_R: 0
        })).data,
      }])).to.be.revertedWith("MINIMUM_RESERVE_C")

      await expect(utr.exec([], [{
        inputs: [{
          mode: PAYMENT,
          eip: 20,
          token: weth.address,
          id: 0,
          amountIn: 50,
          recipient: poolAddress,
        }],
        code: stateCalHelper.address,
        data: (await stateCalHelper.populateTransaction.swap({
          sideIn: SIDE_R,
          poolIn: poolAddress,
          sideOut: SIDE_A,
          poolOut: poolAddress,
          amountIn: 50,
          payer: owner.address,
          recipient: owner.address,
          INDEX_R: 0
        })).data,
      }])).to.be.revertedWith("MINIMUM_RESERVE_A")

      await expect(utr.exec([], [{
        inputs: [{
          mode: PAYMENT,
          eip: 20,
          token: weth.address,
          id: 0,
          amountIn: 50,
          recipient: poolAddress,
        }],
        code: stateCalHelper.address,
        data: (await stateCalHelper.populateTransaction.swap({
          sideIn: SIDE_R,
          poolIn: poolAddress,
          sideOut: SIDE_B,
          poolOut: poolAddress,
          amountIn: 50,
          payer: owner.address,
          recipient: owner.address,
          INDEX_R: 0
        })).data,
      }])).to.be.revertedWith("MINIMUM_RESERVE_B")
    })
  })

  describe("PoolLogic", function () {
    it("onlyItsPool: UNAUTHORIZED_MINT_BURN", async function () {
      const { derivable1155, owner } = await loadFixture(fixture)
      await expect(
        derivable1155.mintLock(owner.address, 1, 1, 0, "0x00")
      ).to.be.revertedWith("UNAUTHORIZED_MINT_BURN")
      await expect(
        derivable1155.burn(owner.address, 1, 1)
      ).to.be.revertedWith("UNAUTHORIZED_MINT_BURN")
    })
  })
})
