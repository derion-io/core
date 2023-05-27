const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { ethers } = require("hardhat");
const { weiToNumber, bn, numberToWei, packId, encodeSqrtX96, attemptSwap } = require("./shared/utilities");

use(solidity)

const SECONDS_PER_DAY = 86400

const HLs = [19932680, 1966168] // 0.3%, 3%

const FEE_RATE = 12

function toDailyRate(HALF_LIFE) {
  return HALF_LIFE == 0 ? 0 : 1-2**(-SECONDS_PER_DAY/HALF_LIFE)
}

function toHalfLife(dailyRate) {
  return dailyRate == 0 ? 0 : SECONDS_PER_DAY/Math.log2(1/(1-dailyRate))
}

HLs.forEach(HALF_LIFE => {
  const dailyInterestRate = toDailyRate(HALF_LIFE)
  describe(`Interest rate fee: Interest rate ${dailyInterestRate}`, function () {
    async function deployDDLv2() {
      const [owner, accountA, accountB] = await ethers.getSigners();
      const signer = owner;
      // deploy token1155

      const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
      const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
      const utr = await UniversalRouter.deploy()
      await utr.deployed()

      // deploy pool factory
      const PoolFactory = await ethers.getContractFactory("PoolFactory");
      const poolFactory = await PoolFactory.deploy(
        owner.address,
      );

      // weth test
      const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
      const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
      // uniswap factory
      const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
      const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);
      // uniswap router

      const compiledUniswapv3Router = require("./compiled/SwapRouter.json");
      const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer);
      // uniswap PM

      const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
      const UniswapPositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer);
      // erc20 factory

      const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
      const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
      // setup uniswap

      const usdc = await erc20Factory.deploy(numberToWei(100000000000));
      const weth = await WETH.deploy();
      const uniswapFactory = await UniswapFactory.deploy();
      const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
      const uniswapPositionManager = await UniswapPositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')

      await uniswapFactory.createPool(usdc.address, weth.address, 500)

      const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
      const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
      const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);

      await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256);
      await weth.approve(uniswapRouter.address, ethers.constants.MaxUint256);

      const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
      const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
      const a = await uniswapPair.initialize(initPriceX96)
      a.wait(1);

      await time.increase(1000);

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

      // deploy ddl pool
      const oracle = ethers.utils.hexZeroPad(
        bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
        32,
      )
      const params = {
        utr: utr.address,
        token: derivable1155.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(1000).shl(128).div(38),
        k: 5,
        a: '30000000000',
        b: '30000000000',
        initTime: await time.latest(),
        halfLife: HALF_LIFE,
        premiumRate: 0,
        minExpirationD: 0,
        minExpirationC: 0,
        discountRate: 0,
      }
      const poolAddress = await poolFactory.computePoolAddress(params);
      let txSignerA = weth.connect(accountA);
      let txSignerB = weth.connect(accountB);

      await txSignerA.deposit({
        value: '100000000000000000000000000000'
      })
      await txSignerB.deposit({
        value: '100000000000000000000000000000'
      })
      await weth.deposit({
        value: '100000000000000000000000000000'
      })
      await weth.transfer(poolAddress, numberToWei(1));
      await poolFactory.createPool(params);
      const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params));

      await time.increase(100);
      // deploy helper
      const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
      const stateCalHelper = await StateCalHelper.deploy(
        derivable1155.address,
        weth.address
      )
      await stateCalHelper.deployed()

      const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
      const derivableHelper = await DerivableHelper.deploy(
        derivablePool.address,
        derivable1155.address,
        stateCalHelper.address
      )
      await derivableHelper.deployed()

      const A_ID = packId(0x10, derivablePool.address);
      const B_ID = packId(0x20, derivablePool.address);
      const R_ID = packId(0x00, derivablePool.address);
      const C_ID = packId(0x30, derivablePool.address);
      await weth.approve(derivablePool.address, '100000000000000000000000000');

      txSignerA = weth.connect(accountA);
      txSignerB = weth.connect(accountB);
      await txSignerA.approve(derivablePool.address, '100000000000000000000000000');
      await txSignerB.approve(derivablePool.address, '100000000000000000000000000');
      txSignerA = derivable1155.connect(accountA);
      await txSignerA.setApprovalForAll(derivablePool.address, true);
      txSignerB = derivable1155.connect(accountB);
      await txSignerB.setApprovalForAll(derivablePool.address, true);
      txSignerA = derivablePool.connect(accountA);
      txSignerB = derivablePool.connect(accountB);

      async function swapAndWaitStatic(period, amount, side) {
        await attemptSwap(
          txSignerA,
          0,
          0x00,
          side,
          amount,
          stateCalHelper.address,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )

        const sR = (await derivablePool.getStates())[0]
        const protocolFeeBefore = await derivablePool.callStatic.collect()
        await time.increase(period)

        const protocolFeeAfter = await derivablePool.callStatic.collect()
        const protocolFee = protocolFeeAfter.sub(protocolFeeBefore)
        const message = `${side == 0x10 ? 'LONG' : 'SHORT'} - ${weiToNumber(amount)}eth - sR ${weiToNumber(sR)} - ${period / HALF_LIFE}HL`
        const dailyFeeRate = toDailyRate(HALF_LIFE * FEE_RATE)
        expect(dailyInterestRate/dailyFeeRate).closeTo(FEE_RATE, FEE_RATE/10, 'effective fee rate')
        expect(Number(weiToNumber(protocolFee)) / Number(weiToNumber((sR))))
          .to.be.closeTo((1 - (1 - dailyFeeRate) ** (period / SECONDS_PER_DAY)), 0.000000000001, message)
      }

      async function swapAndWait(period, amount, side) {
        await attemptSwap(
          txSignerA,
          0,
          0x00,
          side,
          amount,
          stateCalHelper.address,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )

        const sR = (await derivablePool.getStates())[0]
        await derivablePool.collect()

        const balanceBeforeCollect = await weth.balanceOf(owner.address)
        await time.increase(period)

        await derivablePool.collect()
        const balanceAfterCollect = await weth.balanceOf(owner.address)
        const protocolFee = balanceAfterCollect.sub(balanceBeforeCollect)
        const message = `${side == 0x10 ? 'LONG' : 'SHORT'} - ${weiToNumber(amount)}eth - sR ${weiToNumber(sR)} - ${period / HALF_LIFE}HL`
        const dailyFeeRate = toDailyRate(HALF_LIFE * FEE_RATE)
        expect(dailyInterestRate/dailyFeeRate).closeTo(FEE_RATE, FEE_RATE/10, 'effective fee rate')
        expect(Number(weiToNumber(protocolFee)) / Number(weiToNumber((sR))))
          .to.be.closeTo((1 - (1 - dailyFeeRate) ** (period / SECONDS_PER_DAY)), 0.0000001, message)
      }

      await poolFactory.setFeeTo(owner.address)

      return {
        C_ID,
        utr,
        owner,
        weth,
        derivablePool,
        derivable1155,
        derivableHelper,
        accountA,
        accountB,
        txSignerA,
        txSignerB,
        swapAndWaitStatic,
        swapAndWait,
        stateCalHelper
      }
    }

    describe("Long", function () {
      it("Wait 1 day - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(24 * 3600, numberToWei(2), 0x10)
      })

      it("Wait 2 days - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(3 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 7 days - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(7 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 6 months - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(6 * 30 * 24 * 3600, numberToWei(2), 0x10)
      })

      it("Wait 1 day", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(24 * 3600, numberToWei(2), 0x10)
      })

      it("Wait 2 days", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(3 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 7 days", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(7 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 6 months", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(6 * 30 * 24 * 3600, numberToWei(2), 0x10)
      })
    })

    describe("Short", function () {
      it("Wait 1 day - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(SECONDS_PER_DAY, numberToWei(1), 0x20)
      })

      it("Wait 2 days - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(2 * 24 * 3600, numberToWei(0.1), 0x20)
      })

      it("Wait 7 days - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(7 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 6 months - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(6 * 30 * 24 * 3600, numberToWei(2), 0x20)
      })

      it("Wait 1 day", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(SECONDS_PER_DAY, numberToWei(1), 0x20)
      })

      it("Wait 2 days", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(2 * 24 * 3600, numberToWei(0.1), 0x20)
      })

      it("Wait 7 days", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(7 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 6 months", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(6 * 30 * 24 * 3600, numberToWei(2), 0x20)
      })
    })
  })
})


