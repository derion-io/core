const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { ethers } = require("hardhat");
const { _init, _selectPrice, _evaluate } = require("./shared/AsymptoticPerpetual");
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant");
const { weiToNumber, bn, numberToWei, packId, encodeSqrtX96, attemptSwap, feeToOpenRate } = require("./shared/utilities");
const { AddressZero, MaxUint256 } = require("@ethersproject/constants");

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
    async function fixture() {
      const [owner, accountA, accountB] = await ethers.getSigners();
      const signer = owner;

      const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
      const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
      const utr = await UniversalRouter.deploy()
      await utr.deployed()

      // deploy oracle library
      const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
      const oracleLibrary = await OracleLibrary.deploy()
      await oracleLibrary.deployed()

      // deploy fee receiver
      const FeeReceiver = await ethers.getContractFactory("FeeReceiver")
      const feeReceiver = await FeeReceiver.deploy(owner.address)
      await feeReceiver.deployed()

      // deploy pool factory
      const PoolFactory = await ethers.getContractFactory("PoolFactory");
      const poolFactory = await PoolFactory.deploy(
        feeReceiver.address,
        FEE_RATE
      );
      await poolFactory.deployed()

      // deploy descriptor
      const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
      const tokenDescriptor = await TokenDescriptor.deploy()
      await tokenDescriptor.deployed()

      // deploy token1155
      const Token = await ethers.getContractFactory("Token")
      const derivable1155 = await Token.deploy(
        utr.address,
        owner.address,
        tokenDescriptor.address
      )
      await derivable1155.deployed()

      // weth test
      const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
      const WETH = new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
      const weth = await WETH.deploy();
      await weth.deposit({
        value: numberToWei("10000000000000000000")
      })

      // erc20 factory
      const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
      const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
      const usdc = await erc20Factory.deploy(numberToWei(100000000000));

      const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
      const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
      // INIT PAIRRRRR 
      const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
      const uniswapPair = await Univ3PoolMock.deploy(
        initPriceX96,
        initPriceX96,
        quoteTokenIndex ? weth.address : usdc.address,
        quoteTokenIndex ? usdc.address : weth.address,
      )
      await uniswapPair.deployed()

      // deploy ddl pool
      const oracle = ethers.utils.hexZeroPad(
        bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
        32,
      )
      let params = {
        utr: utr.address,
        token: derivable1155.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(38).shl(128),
        k: bn(5),
        a: numberToWei(1),
        b: numberToWei(1),
        initTime: bn(await time.latest()),
        halfLife: bn(HALF_LIFE),
        premiumRate: 0,
        minExpirationD: 0,
        minExpirationC: 0,
        discountRate: 0,
        feeHalfLife: 0,
        openRate: feeToOpenRate(0)
      }
      params = await _init(oracleLibrary, numberToWei("5"), params)
      const config = {
        TOKEN: params.token,
        TOKEN_R: params.reserveToken,
        ORACLE: params.oracle,
        K: params.k,
        MARK: params.mark,
        INIT_TIME: params.initTime,
        HALF_LIFE: bn(params.halfLife),
        PREMIUM_RATE: bn(params.premiumRate)
      }
      const poolAddress = await poolFactory.computePoolAddress(params)
      await weth.transfer(poolAddress, numberToWei("5"));
      await poolFactory.createPool(params);
      const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", await poolFactory.computePoolAddress(params))

      await weth.approve(derivablePool.address, MaxUint256)
      await derivable1155.setApprovalForAll(derivablePool.address, true)

      // deploy helper
      const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
      const stateCalHelper = await StateCalHelper.deploy(
        derivable1155.address,
        weth.address
      )
      await stateCalHelper.deployed()

      const A_ID = packId(0x10, derivablePool.address);
      const B_ID = packId(0x20, derivablePool.address);
      const C_ID = packId(0x30, derivablePool.address);

      async function getFeeFromSwap(side, amount, period) {
        const state = await derivablePool.getStates()
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

        await attemptSwap(
          derivablePool,
          0,
          SIDE_R,
          side,
          numberToWei(amount),
          stateCalHelper.address,
          AddressZero,
          owner.address
        )

        const feeAmount = await weth.balanceOf(feeReceiver.address)
        const interestRate = 1 - (1 - dailyInterestRate) ** period
        const feeRate = 1 - (1 - (dailyInterestRate / FEE_RATE)) ** period
        const pReservedAfterInterest = positionReserved.mul(((1 - interestRate) * 1e8).toFixed(0)).div(1e8)
        const actualFeeRate = Number(weiToNumber(feeAmount)) / Number(weiToNumber(pReservedAfterInterest))

        expect(feeRate / actualFeeRate).to.be.closeTo(1, 0.1)
      }

      return {
        config,
        feeReceiver,
        derivable1155,
        derivablePool,
        stateCalHelper,
        uniswapPair,
        oracleLibrary,
        A_ID,
        B_ID,
        C_ID,
        accountA,
        accountB,
        owner,
        weth,
        getFeeFromSwap
      }
    }

    it("Charge fee: Open 0.1e Long - period 1 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_A, 0.1, 1)
    })

    it("Charge fee: Open 1e Long - period 10 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_A, 1, 10)
    })

    it("Charge fee: Open 5e Long - period 100 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_A, 5, 100)
    })

    it("Charge fee: Open 1e Long - period 365 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_A, 1, 365)
    })

    it("Charge fee: Open 0.1e Short - period 1 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_B, 0.1, 1)
    })

    it("Charge fee: Open 1e Short - period 10 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_B, 1, 10)
    })

    it("Charge fee: Open 5e Short - period 100 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_B, 5, 100)
    })

    it("Charge fee: Open 1e Short - period 365 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_B, 1, 365)
    })

    it("Charge fee: Open 0.1e LP - period 1 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_C, 0.1, 1)
    })

    it("Charge fee: Open 1e LP - period 10 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_C, 1, 10)
    })

    it("Charge fee: Open 5e LP - period 100 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_C, 5, 100)
    })

    it("Charge fee: Open 1e LP - period 365 day", async function () {
      const { getFeeFromSwap } = await loadFixture(fixture)
      await getFeeFromSwap(SIDE_C, 1, 365)
    })
  })
})