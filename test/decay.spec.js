const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96 } = require("./shared/utilities");

const opts = {
  gasLimit: 30000000
}

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Decay funding rate", function () {
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
      // derivable1155.address
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

    const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual");

    const asymptoticPerpetual = await AsymptoticPerpetual.deploy();
    await asymptoticPerpetual.deployed();

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      "Test/",
      utr.address
    )
    await derivable1155.deployed()

    // deploy ddl pool
    const oracle = ethers.utils.hexZeroPad(
      bn(quoteTokenIndex).shl(255).add(bn(300).shl(256-64)).add(uniswapPair.address).toHexString(),
      32,
    )
    const params = {
        utr: utr.address,
        token: derivable1155.address,
        logic: asymptoticPerpetual.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(25).shl(112).div(1000),
        k: 5,
        a: '30000000000',
        b: '30000000000',
        halfLife: HALF_LIFE // ten years
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
    const A_ID = packId(0x10, derivablePool.address);
    const B_ID = packId(0x20, derivablePool.address);
    const R_ID = packId(0x00, derivablePool.address);
    const LP_ID = packId(0x30, derivablePool.address);
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

    await txSignerA.exactIn(
      0x00,
      numberToWei(0.5),
      0x30,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    );

    async function swapAndRedeemInHalfLife(period, amountA, amountB) {
      await txSignerA.exactIn(
        0x00,
        amountA,
        0x10,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      );
      await txSignerB.exactIn(
        0x00,
        amountB,
        0x20,
        '0x0000000000000000000000000000000000000000',
        accountB.address
      );
      const aTokenAmount = await derivable1155.balanceOf(accountA.address, A_ID)
      const bTokenAmount = await derivable1155.balanceOf(accountB.address, B_ID)
      const valueABefore = await txSignerA.callStatic.exactIn(
        0x10,
        aTokenAmount,
        0x00,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )
      const valueBBefore = await txSignerB.callStatic.exactIn(
        0x20,
        bTokenAmount,
        0x00,
        '0x0000000000000000000000000000000000000000',
        accountB.address
      )
      if (period != 0)
        await time.increase(period * HALF_LIFE)
      
      const aBefore = await weth.balanceOf(accountA.address)
      const bBefore = await weth.balanceOf(accountB.address)

      await txSignerA.exactIn(
        0x10,
        aTokenAmount,
        0x00,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )
      await txSignerB.exactIn(
        0x20,
        bTokenAmount,
        0x00,
        '0x0000000000000000000000000000000000000000',
        accountB.address
      )

      const aAfter = await weth.balanceOf(accountA.address)
      const bAfter = await weth.balanceOf(accountB.address)
      return {
        long: aAfter.sub(aBefore),
        short: bAfter.sub(bBefore),
        longFee: valueABefore.sub(aAfter.sub(aBefore)),
        shortFee: valueBBefore.sub(bAfter.sub(bBefore))
      }
    }

    async function compareBalance(period) {
      const origin = await swapAndRedeemInHalfLife(1, numberToWei(0.5), numberToWei(0.5))
      const after = await swapAndRedeemInHalfLife(period, numberToWei(0.5), numberToWei(0.5))
      const expectRatio = (1-0.5)/(1-0.5**period)

      expect(Number(weiToNumber(origin.longFee)/Number(weiToNumber(after.longFee)))).to.be.closeTo(expectRatio,  0.000001)
      expect(Number(weiToNumber(origin.shortFee)/Number(weiToNumber(after.shortFee)))).to.be.closeTo(expectRatio,  0.000001)
    }

    async function compareMuchMoreLong(period) {
      const origin = await swapAndRedeemInHalfLife(1, numberToWei(2.5), numberToWei(0.5))
      const after = await swapAndRedeemInHalfLife(period, numberToWei(2.5), numberToWei(0.5))
      const expectRatio = (1-0.5)/(1-0.5**period)

      expect(Number(weiToNumber(origin.longFee)/Number(weiToNumber(after.longFee)))).to.be.closeTo(expectRatio,  0.000001)
      expect(Number(weiToNumber(origin.shortFee)/Number(weiToNumber(after.shortFee)))).to.be.closeTo(expectRatio,  0.000001)
    }

    async function compareMuchMoreShort(period) {
      const origin = await swapAndRedeemInHalfLife(1, numberToWei(0.5), numberToWei(2.5))
      const after = await swapAndRedeemInHalfLife(period, numberToWei(0.5), numberToWei(2.5))
      const expectRatio = (1-0.5)/(1-0.5**period)
      console.log(origin)
      console.log(after)

      expect(Number(weiToNumber(origin.longFee)/Number(weiToNumber(after.longFee)))).to.be.closeTo(expectRatio,  0.000001)
      expect(Number(weiToNumber(origin.shortFee)/Number(weiToNumber(after.shortFee)))).to.be.closeTo(expectRatio,  0.000001)
    }

    return {
      LP_ID,
      owner,
      weth,
      derivablePool,
      derivable1155,
      accountA,
      accountB,
      txSignerA,
      txSignerB,
      swapAndRedeemInHalfLife,
      compareBalance,
      compareMuchMoreLong,
      compareMuchMoreShort
    }
  }

  describe("Pool", function () {
    it("LP increase over time", async function() {
      const { swapAndRedeemInHalfLife, accountA, txSignerA, derivable1155, LP_ID } = await loadFixture(deployDDLv2);
      const lpAmount = await derivable1155.balanceOf(accountA.address, LP_ID)
      const originLPValue = await txSignerA.callStatic.exactIn(
        0x30,
        lpAmount,
        0x00,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )
      await swapAndRedeemInHalfLife(1, numberToWei(1), numberToWei(1))
      const afterLPValue = await txSignerA.callStatic.exactIn(
        0x30,
        lpAmount,
        0x00,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )
      expect(afterLPValue.gt(originLPValue)).to.be.true
    })
    describe("Pool balance:", function () {
      it("Decay 0.3", async function () {
        const { compareBalance } = await loadFixture(deployDDLv2);
        await compareBalance(0.3)
      })
      it("Decay 0.5", async function () {
        const { compareBalance } = await loadFixture(deployDDLv2);
        await compareBalance(0.5)
      })
      it("Decay 1", async function () {
        const { compareBalance } = await loadFixture(deployDDLv2);
        await compareBalance(1)
      })
      it("Decay 2", async function () {
        const { compareBalance } = await loadFixture(deployDDLv2);
        await compareBalance(2)
      })
      it("Decay same range, different time", async function () {
        const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
        const before = await swapAndRedeemInHalfLife(0.1, numberToWei(1), numberToWei(1))
        await time.increase(10 * HALF_LIFE)
        const after = await swapAndRedeemInHalfLife(0.1, numberToWei(1), numberToWei(1))
        expect(Math.abs(before.long.sub(after.long).toNumber())).to.be.lessThanOrEqual(2)
        expect(Math.abs(before.short.sub(after.short).toNumber())).to.be.lessThanOrEqual(2)
      })  
    })

    describe("Pool long > R/2:", function () {
      it("Decay 0.3", async function () {
        const { compareMuchMoreLong } = await loadFixture(deployDDLv2);
        await compareMuchMoreLong(0.3)
      })
      it("Decay 0.5", async function () {
        const { compareMuchMoreLong } = await loadFixture(deployDDLv2);
        await compareMuchMoreLong(0.5)
      })
      it("Decay 1", async function () {
        const { compareMuchMoreLong } = await loadFixture(deployDDLv2);
        await compareMuchMoreLong(1)
      })
      it("Decay 2", async function () {
        const { compareMuchMoreLong } = await loadFixture(deployDDLv2);
        await compareMuchMoreLong(2)
      })
      it("Decay same range, different time", async function () {
        const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
        const before = await swapAndRedeemInHalfLife(0.1, numberToWei(2.5), numberToWei(1))
        await time.increase(10 * HALF_LIFE)
        const after = await swapAndRedeemInHalfLife(0.1, numberToWei(2.5), numberToWei(1))
        expect(Math.abs(before.long.sub(after.long).toNumber())).to.be.lessThanOrEqual(2)
        expect(Math.abs(before.short.sub(after.short).toNumber())).to.be.lessThanOrEqual(2)
      })

    })

    describe("Pool short > R/2:", function () {
      it("Decay 0.3", async function () {
        const { compareMuchMoreShort } = await loadFixture(deployDDLv2);
        await compareMuchMoreShort(0.3)
      })
      it("Decay 0.5", async function () {
        const { compareMuchMoreShort } = await loadFixture(deployDDLv2);
        await compareMuchMoreShort(0.5)
      })
      it("Decay 1", async function () {
        const { compareMuchMoreShort } = await loadFixture(deployDDLv2);
        await compareMuchMoreShort(1)
      })
      it("Decay 2", async function () {
        const { compareMuchMoreShort } = await loadFixture(deployDDLv2);
        await compareMuchMoreShort(2)
      })
      it("Decay same range, different time", async function () {
        const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
        const before = await swapAndRedeemInHalfLife(0.1, numberToWei(1), numberToWei(2.5))
        await time.increase(10 * HALF_LIFE)
        const after = await swapAndRedeemInHalfLife(0.1, numberToWei(1), numberToWei(2.5))
        expect(Math.abs(before.long.sub(after.long).toNumber())).to.be.lessThanOrEqual(2)
        expect(Math.abs(before.short.sub(after.short).toNumber())).to.be.lessThanOrEqual(2)
      })
    })
  });
})