const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { ethers } = require("hardhat");
const { _init, _evaluate, _selectPrice, _decayRate, _market } = require("./shared/AsymptoticPerpetual");
const { weiToNumber, bn, numberToWei, packId, encodeSqrtX96, attemptSwap, feeToOpenRate, attemptStaticSwap } = require("./shared/utilities");
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant");
const { AddressZero } = require("@ethersproject/constants");

use(solidity)

const SECONDS_PER_DAY = 86400

const HLs = [19932680
  // , 1966168
] // 0.3%, 3%

const FEE_RATE = 5

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

      // deploy oracle library
      const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
      const oracleLibrary = await OracleLibrary.deploy()
      await oracleLibrary.deployed()

      // deploy pool factory
      const PoolFactory = await ethers.getContractFactory("PoolFactory");
      const poolFactory = await PoolFactory.deploy(
        owner.address
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
      let params = {
        utr: utr.address,
        token: derivable1155.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(38).shl(128),
        k: bn(5),
        a: bn('30000000000'),
        b: bn('30000000000'),
        initTime: bn(await time.latest()),
        halfLife: bn(HALF_LIFE),
        premiumRate: bn(1).shl(128).div(2),
        minExpirationD: 0,
        minExpirationC: 0,
        discountRate: 0,
        feeHalfLife: 0,
        openRate: feeToOpenRate(0)
      }

      const config = {
        TOKEN: derivable1155.address,
        TOKEN_R: weth.address,
        ORACLE: oracle,
        K: bn(5),
        MARK: params.mark,
        INIT_TIME: params.initTime,
        HALF_LIFE: bn(params.halfLife),
        PREMIUM_RATE: params.premiumRate
      }

      params = await _init(oracleLibrary, numberToWei(1), params)
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
      const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", await poolFactory.computePoolAddress(params));

      const params1 = {
        ...params,
        halfLife: bn(0)
      }
      const pool1Address = await poolFactory.computePoolAddress(params1);
      await weth.transfer(pool1Address, numberToWei(1));
      await poolFactory.createPool(params1);
      const poolNoHL = await ethers.getContractAt("AsymptoticPerpetual", pool1Address);

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
      await weth.approve(poolNoHL.address, '100000000000000000000000000');

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

        const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
        const state = await derivablePool.getStates()
        const decayRate = _decayRate(bn(await time.latest()).sub(config.INIT_TIME), config.HALF_LIFE)
        
        const minPrice = oraclePrice.twap.lt(oraclePrice.spot) ? oraclePrice.twap : oraclePrice.spot
        const maxPrice = oraclePrice.twap.lt(oraclePrice.spot) ? oraclePrice.spot : oraclePrice.twap
        
        const marketA = _market(config.K, config.MARK, decayRate, minPrice)
        const evalA = _evaluate(marketA, state)

        const marketB = _market(config.K, config.MARK, decayRate, maxPrice)
        const evalB = _evaluate(marketB, state)

        const reserved = evalA.rA.add(evalB.rB)
        
        const protocolFeeBefore = await derivablePool.callStatic.collect()
        await time.increase(period)

        const protocolFeeAfter = await derivablePool.callStatic.collect()
        const protocolFee = protocolFeeAfter.sub(protocolFeeBefore)
        const message = `${side == 0x10 ? 'LONG' : 'SHORT'} - ${weiToNumber(amount)}eth - sR ${weiToNumber(reserved)} - ${period / HALF_LIFE}HL`
        const dailyFeeRate = toDailyRate(HALF_LIFE * FEE_RATE)
        expect(dailyInterestRate/dailyFeeRate).closeTo(FEE_RATE, FEE_RATE/10, 'effective fee rate')
        expect(Number(weiToNumber(protocolFee)) / Number(weiToNumber(reserved)))
          .to.be.closeTo((1 - (1 - dailyFeeRate) ** (period / SECONDS_PER_DAY)), 0.001, message)
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

        const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
        const state = await derivablePool.getStates()
        const decayRate = _decayRate(bn(await time.latest()).sub(config.INIT_TIME), config.HALF_LIFE)
        
        const minPrice = oraclePrice.twap.lt(oraclePrice.spot) ? oraclePrice.twap : oraclePrice.spot
        const maxPrice = oraclePrice.twap.lt(oraclePrice.spot) ? oraclePrice.spot : oraclePrice.twap
        
        const marketA = _market(config.K, config.MARK, decayRate, minPrice)
        const evalA = _evaluate(marketA, state)

        const marketB = _market(config.K, config.MARK, decayRate, maxPrice)
        const evalB = _evaluate(marketB, state)

        const reserved = evalA.rA.add(evalB.rB)

        await derivablePool.collect()

        const balanceBeforeCollect = await weth.balanceOf(owner.address)
        await time.increase(period)

        await derivablePool.collect()
        const balanceAfterCollect = await weth.balanceOf(owner.address)
        const protocolFee = balanceAfterCollect.sub(balanceBeforeCollect)
        const message = `${side == 0x10 ? 'LONG' : 'SHORT'} - ${weiToNumber(amount)}eth - sR ${weiToNumber(reserved)} - ${period / HALF_LIFE}HL`
        const dailyFeeRate = toDailyRate(HALF_LIFE * FEE_RATE)
      
        expect(dailyInterestRate/dailyFeeRate).closeTo(FEE_RATE, FEE_RATE/10, 'effective fee rate')
        expect(Number(weiToNumber(protocolFee)) / Number(weiToNumber((reserved))))
          .to.be.closeTo((1 - (1 - dailyFeeRate) ** (period / SECONDS_PER_DAY)), 0.001, message)
      }

      await poolFactory.setFeeTo(owner.address)

      return {
        C_ID,
        A_ID,
        B_ID,
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
        stateCalHelper,
        poolNoHL
      }
    }

    describe("Long", function () {
      it("Wait 1 day - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 2 days - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(3 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 7 days - static", async function () {
        const { swapAndWaitStatic } = await loadFixture(deployDDLv2);
        await swapAndWaitStatic(7 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 1 day", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 2 days", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(3 * 24 * 3600, numberToWei(0.1), 0x10)
      })

      it("Wait 7 days", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(7 * 24 * 3600, numberToWei(0.1), 0x10)
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
        await swapAndWaitStatic(7 * 24 * 3600, numberToWei(0.1), 0x20)
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
        await swapAndWait(7 * 24 * 3600, numberToWei(0.1), 0x20)
      })
    })

    it("Long, short, LP value before and after fee collect", async function () {
      const {owner, derivablePool, stateCalHelper} = await loadFixture(deployDDLv2)
      await time.increase(SECONDS_PER_DAY)
      const valueLongBefore = await attemptStaticSwap(
        derivablePool,
        0,
        SIDE_A,
        SIDE_R,
        1000,
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      const valueShortBefore = await attemptStaticSwap(
        derivablePool,
        0,
        SIDE_B,
        SIDE_R,
        1000,
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      const valueLPBefore = await attemptStaticSwap(
        derivablePool,
        0,
        SIDE_C,
        SIDE_R,
        1000,
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await derivablePool.collect()

      const valueLongAfter = await attemptStaticSwap(
        derivablePool,
        0,
        SIDE_A,
        SIDE_R,
        1000,
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      const valueShortAfter = await attemptStaticSwap(
        derivablePool,
        0,
        SIDE_B,
        SIDE_R,
        1000,
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      const valueLPAfter = await attemptStaticSwap(
        derivablePool,
        0,
        SIDE_C,
        SIDE_R,
        1000,
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      expect(valueLPAfter).to.be.eq(valueLPBefore)
      expect(valueLongAfter).to.be.eq(valueLongBefore)
      expect(valueShortAfter).to.be.eq(valueShortBefore)
    })

    it("Withdraw all after collect fee", async function () {
      const {owner, derivablePool, stateCalHelper, derivable1155, weth, A_ID, B_ID, C_ID} = await loadFixture(deployDDLv2)

      await time.increase(SECONDS_PER_DAY)
      await derivablePool.collect()
      await attemptSwap(
        derivablePool,
        0,
        SIDE_A,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, A_ID),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await attemptSwap(
        derivablePool,
        0,
        SIDE_B,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, B_ID),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await attemptSwap(
        derivablePool,
        0,
        SIDE_C,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, C_ID),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      const supplyA = await derivable1155.totalSupply(A_ID)
      const supplyB = await derivable1155.totalSupply(B_ID)
      const supplyC =  await derivable1155.totalSupply(C_ID)
      const reserved = await weth.balanceOf(derivablePool.address)

      expect(Number(weiToNumber(supplyA))).to.be.closeTo(0, 1e17)
      expect(Number(weiToNumber(supplyB))).to.be.closeTo(0, 1e17)
      expect(Number(weiToNumber(supplyC))).to.be.closeTo(0, 1e17)
      expect(Number(weiToNumber(reserved))).to.be.closeTo(0, 1e17)
    })

    it("Withdraw all before collect fee", async function () {
      const {owner, derivablePool, stateCalHelper, derivable1155, weth, A_ID, B_ID, C_ID} = await loadFixture(deployDDLv2)

      await time.increase(SECONDS_PER_DAY)
      
      await attemptSwap(
        derivablePool,
        0,
        SIDE_A,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, A_ID),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await attemptSwap(
        derivablePool,
        0,
        SIDE_B,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, B_ID),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await attemptSwap(
        derivablePool,
        0,
        SIDE_C,
        SIDE_R,
        await derivable1155.balanceOf(owner.address, C_ID),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await derivablePool.collect()

      const supplyA = await derivable1155.totalSupply(A_ID)
      const supplyB = await derivable1155.totalSupply(B_ID)
      const supplyC =  await derivable1155.totalSupply(C_ID)
      const reserved = await weth.balanceOf(derivablePool.address)

      expect(Number(weiToNumber(supplyA))).to.be.closeTo(0, 1e17)
      expect(Number(weiToNumber(supplyB))).to.be.closeTo(0, 1e17)
      expect(Number(weiToNumber(supplyC))).to.be.closeTo(0, 1e17)
      expect(Number(weiToNumber(reserved))).to.be.closeTo(0, 1e17)
    })

    it("Collect mutiple time", async function () {
      const {owner, derivablePool, weth} = await loadFixture(deployDDLv2)

      await time.increase(30 * SECONDS_PER_DAY)

      let wethBefore = await weth.balanceOf(owner.address)
      await derivablePool.collect()
      let wethAfter = await weth.balanceOf(owner.address)
      
      const feeOneMonth = wethAfter.sub(wethBefore)

      const dailyRate = toDailyRate(HALF_LIFE)
      console.log('dailyRate', dailyRate)

      await time.increase(60 * SECONDS_PER_DAY)

      wethBefore = await weth.balanceOf(owner.address)
      await derivablePool.collect()
      wethAfter = await weth.balanceOf(owner.address)
      const feeTwoMonth = wethAfter.sub(wethBefore)

      await time.increase(90 * SECONDS_PER_DAY)

      wethBefore = await weth.balanceOf(owner.address)
      await derivablePool.collect()
      wethAfter = await weth.balanceOf(owner.address)
      const feeThreeMonth = wethAfter.sub(wethBefore)

      expect(feeOneMonth.add(feeTwoMonth)).to.be.gt(feeThreeMonth)
    })

    it("Open position do not change fee", async function () {
      const {owner, derivablePool, derivable1155, stateCalHelper, A_ID, B_ID} = await loadFixture(deployDDLv2)

      await attemptSwap(
        derivablePool,
        0,
        SIDE_R,
        SIDE_A,
        numberToWei(0.01),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await attemptSwap(
        derivablePool,
        0,
        SIDE_R,
        SIDE_B,
        numberToWei(0.01),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )
      
      await time.increase(30*SECONDS_PER_DAY)

      const beforeSwapCollect = await derivablePool.callStatic.collect()
      let tokenBalance = await derivable1155.balanceOf(owner.address, A_ID)
      await attemptSwap(
        derivablePool,
        0,
        SIDE_R,
        SIDE_A,
        numberToWei(0.01),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )
      tokenBalance = await derivable1155.balanceOf(owner.address, B_ID)
      await attemptSwap(
        derivablePool,
        0,
        SIDE_R,
        SIDE_B,
        numberToWei(0.01),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )
      const afterSwapCollect = await derivablePool.callStatic.collect()

      expect(Number(weiToNumber(beforeSwapCollect)))
      .to.be.closeTo(Number(weiToNumber(afterSwapCollect)), 0.0001)
    })

    it("Close position do not change fee", async function () {
      const {owner, derivablePool, weth, stateCalHelper} = await loadFixture(deployDDLv2)

      await time.increase(30 * SECONDS_PER_DAY)

      const beforeSwapCollect = await derivablePool.callStatic.collect()

      await attemptSwap(
        derivablePool,
        0,
        SIDE_A,
        SIDE_R,
        numberToWei(0.01),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      await attemptSwap(
        derivablePool,
        0,
        SIDE_B,
        SIDE_R,
        numberToWei(0.01),
        stateCalHelper.address,
        AddressZero,
        owner.address
      )

      const afterSwapCollect = await derivablePool.callStatic.collect()

      expect(Number(weiToNumber(beforeSwapCollect)))
      .to.be.closeTo(Number(weiToNumber(afterSwapCollect)), 0.0001)
    })
  })
})


