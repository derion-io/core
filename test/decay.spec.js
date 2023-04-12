const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96 } = require("./shared/utilities");

use(solidity)

const opts = {
  gasLimit: 30000000
}

const TRANSFER_FROM_SENDER = 0
const TRANSFER_FROM_ROUTER = 1
const TRANSFER_CALL_VALUE = 2
const IN_TX_PAYMENT = 4
const ALLOWANCE_BRIDGE = 8
const AMOUNT_EXACT = 0
const AMOUNT_ALL = 1
const EIP_ETH = 0
const ID_721_ALL = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ID_721_ALL"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4


const HLs = [0, 10 * 365 * 24 * 60 * 60]

HLs.forEach(HALF_LIFE => {
  describe(`HALF_LIFE ${HALF_LIFE == 0 ? '= 0' : '> 0'} Decay funding rate`, function () {
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
        bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
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
      // deploy helper
      const DerivableHelper = await ethers.getContractFactory("Helper")
      const derivableHelper = await DerivableHelper.deploy(
        derivablePool.address,
        derivable1155.address
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

      await txSignerA.exactIn(
        0x00,
        numberToWei(0.5),
        0x30,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      );

      async function swapAndWait(period, waitingTime, amountA, amountB) {
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

        const aFirstBefore = await txSignerA.callStatic.exactIn(
          0x10,
          aTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )
        const bFirstBefore = await txSignerB.callStatic.exactIn(
          0x20,
          bTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        )
        if (period > 0)
          await time.increase(period)
        const aFirstAfter = await txSignerA.callStatic.exactIn(
          0x10,
          aTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )
        const bFirstAfter = await txSignerB.callStatic.exactIn(
          0x20,
          bTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        )
        if (waitingTime > 0)
          await time.increase(waitingTime)
        const aSecondBefore = await txSignerA.callStatic.exactIn(
          0x10,
          aTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )
        const bSecondBefore = await txSignerB.callStatic.exactIn(
          0x20,
          bTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        )
        if (period > 0)
          await time.increase(period)
        const aSecondAfter = await txSignerA.callStatic.exactIn(
          0x10,
          aTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )
        const bSecondAfter = await txSignerB.callStatic.exactIn(
          0x20,
          bTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        )

        const secondLongRate = Number(weiToNumber(aSecondAfter)) / Number(weiToNumber(aSecondBefore))
        const firstLongRate = Number(weiToNumber(aFirstAfter)) / Number(weiToNumber(aFirstBefore))

        const secondShortRate = Number(weiToNumber(bSecondAfter)) / Number(weiToNumber(bSecondBefore))
        const firstShortRate = Number(weiToNumber(bFirstAfter)) / Number(weiToNumber(bFirstBefore))
        if (amountA.gt(amountB) & HALF_LIFE > 0) {
          expect(aFirstBefore.sub(aFirstAfter)).gt(aSecondBefore.sub(aSecondAfter)).gt(0)
          expect(secondShortRate).to.be.closeTo(firstShortRate, 0.000001)
        } else if (amountA.lt(amountB) & HALF_LIFE > 0) {
          expect(secondLongRate).to.be.closeTo(firstLongRate, 0.000001)
          expect(bFirstBefore.sub(bFirstAfter)).gt(bSecondBefore.sub(bSecondAfter)).gt(0)
        } else {
          expect(secondLongRate).to.be.closeTo(firstLongRate, 0.000001)
          expect(secondShortRate).to.be.closeTo(firstShortRate, 0.000001)
        }
      }

      async function instantSwapBackUTR(amountA, amountB) {
        // Acc A
        txSignerA = weth.connect(accountA);
        const beforeA = await weth.balanceOf(accountA.address)
        await txSignerA.approve(utr.address, ethers.constants.MaxUint256)
        txSignerA = utr.connect(accountA);
        await txSignerA.exec([],
          [
            {
              inputs: [{
                mode: IN_TX_PAYMENT,
                eip: 20,
                token: weth.address,
                id: 0,
                amountSource: AMOUNT_EXACT,
                amountInMax: amountA,
                recipient: derivablePool.address,
              }],
              flags: 0,
              code: derivablePool.address,
              data: (await derivablePool.populateTransaction.exactIn(
                0x00,
                amountA,
                0x10,
                accountA.address,
                derivableHelper.address
              )).data,
            },
            {
              inputs: [],
              flags: 0,
              code: derivableHelper.address,
              data: (await derivableHelper.populateTransaction.swapInAll(
                0x10,
                0x00,
                ethers.constants.AddressZero,
                accountA.address
              )).data,
            }
          ], opts)
        const afterA = await weth.balanceOf(accountA.address)
        expect(beforeA.gte(afterA)).to.be.true
        // Acc B
        txSignerB = weth.connect(accountB);
        const beforeB = await weth.balanceOf(accountB.address)
        await txSignerB.approve(utr.address, ethers.constants.MaxUint256)
        txSignerB = utr.connect(accountB);
        await txSignerB.exec([],
          [
            {
              inputs: [{
                mode: IN_TX_PAYMENT,
                eip: 20,
                token: weth.address,
                id: 0,
                amountSource: AMOUNT_EXACT,
                amountInMax: amountB,
                recipient: derivablePool.address,
              }],
              flags: 0,
              code: derivablePool.address,
              data: (await derivablePool.populateTransaction.exactIn(
                0x00,
                amountB,
                0x20,
                accountB.address,
                derivableHelper.address
              )).data,
            },
            {
              inputs: [],
              flags: 0,
              code: derivableHelper.address,
              data: (await derivableHelper.populateTransaction.swapInAll(
                0x20,
                0x00,
                ethers.constants.AddressZero,
                accountB.address
              )).data,
            }
          ], opts)
        const afterB = await weth.balanceOf(accountB.address)
        expect(beforeB.gte(afterB)).to.be.true
      }

      async function groupSwapBack(amountA, amountB) {
        txSignerA = weth.connect(accountA);
        const beforeA = await weth.balanceOf(accountA.address)
        const beforeB = await weth.balanceOf(accountB.address)
        await txSignerA.approve(utr.address, ethers.constants.MaxUint256)
        txSignerA = utr.connect(accountA);
        await txSignerA.exec([],
          [
            {
              inputs: [{
                mode: IN_TX_PAYMENT,
                eip: 20,
                token: weth.address,
                id: 0,
                amountSource: AMOUNT_EXACT,
                amountInMax: amountB,
                recipient: derivablePool.address,
              }],
              flags: 0,
              code: derivablePool.address,
              data: (await derivablePool.populateTransaction.exactIn(
                0x00,
                amountB,
                0x20,
                accountA.address,
                derivableHelper.address
              )).data,
            },
            {
              inputs: [{
                mode: IN_TX_PAYMENT,
                eip: 20,
                token: weth.address,
                id: 0,
                amountSource: AMOUNT_EXACT,
                amountInMax: amountA,
                recipient: derivablePool.address,
              }],
              flags: 0,
              code: derivablePool.address,
              data: (await derivablePool.populateTransaction.exactIn(
                0x00,
                amountA,
                0x10,
                accountA.address,
                derivableHelper.address
              )).data,
            },
            {
              inputs: [],
              flags: 0,
              code: derivableHelper.address,
              data: (await derivableHelper.populateTransaction.swapInAll(
                0x10,
                0x00,
                ethers.constants.AddressZero,
                accountA.address
              )).data,
            },
            {
              inputs: [],
              flags: 0,
              code: derivableHelper.address,
              data: (await derivableHelper.populateTransaction.swapInAll(
                0x20,
                0x00,
                ethers.constants.AddressZero,
                accountB.address
              )).data,
            }
          ], opts)
        const afterA = await weth.balanceOf(accountA.address)
        const afterB = await weth.balanceOf(accountB.address)
        const changeOfA = beforeA.sub(amountB).sub(afterA)
        const changeOfB = afterB.sub(beforeB)
        console.log(changeOfA)
        console.log(changeOfB)
        // expect(amountB.gte(changeOfB)).to.be.true
      }

      async function instantSwapBackNonUTR(amountA, amountB) {
        txSignerA = derivablePool.connect(accountA)
        await txSignerA.exactIn(
          0x00,
          amountA,
          0x10,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        const aTokenAmount = await derivable1155.balanceOf(accountA.address, A_ID)
        const valueA = await txSignerA.callStatic.exactIn(
          0x10,
          aTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )
        txSignerB = derivablePool.connect(accountB)
        await txSignerB.exactIn(
          0x00,
          amountB,
          0x20,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        );
        const bTokenAmount = await derivable1155.balanceOf(accountB.address, B_ID)
        const valueB = await txSignerB.callStatic.exactIn(
          0x20,
          bTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        )
        expect(amountA.gte(valueA)).to.be.true
        expect(amountB.gte(valueB)).to.be.true
      }

      async function swapBackInAHalfLife(amountA, amountB, caseName) {
        txSignerA = derivablePool.connect(accountA)
        await txSignerA.exactIn(
          0x00,
          amountA,
          0x10,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        txSignerB = derivablePool.connect(accountB)
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
        if (HALF_LIFE > 0)
          await time.increase(HALF_LIFE)
        const valueAAfter = await txSignerA.callStatic.exactIn(
          0x10,
          aTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )
        const valueBAfter = await txSignerB.callStatic.exactIn(
          0x20,
          bTokenAmount,
          0x00,
          '0x0000000000000000000000000000000000000000',
          accountB.address
        )
        expect(valueABefore.div(2).sub(valueAAfter)).to.be.lte(
          1,
          `${caseName}: Value long should be half after halflife`
        )
        expect(valueBBefore.div(2).sub(valueBAfter)).to.be.lte(
          1,
          `${caseName}: Value long should be half after halflife`
        )
      }

      async function swapAndRedeemInHalfLife(period, amountA, amountB) {
        txSignerA = derivablePool.connect(accountA)
        txSignerB = derivablePool.connect(accountB)
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
        if (period != 0 && HALF_LIFE > 0) {
          await time.increase(period * HALF_LIFE)
        }

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
        const expectRatio = (1 - 0.5) / (1 - 0.5 ** period)

        expect(Number(weiToNumber(origin.longFee) / Number(weiToNumber(after.longFee)))).to.be.closeTo(expectRatio, 0.000001)
        expect(Number(weiToNumber(origin.shortFee) / Number(weiToNumber(after.shortFee)))).to.be.closeTo(expectRatio, 0.000001)
      }

      async function compareMuchMoreLong(period) {
        const origin = await swapAndRedeemInHalfLife(1, numberToWei(2.5), numberToWei(0.5))
        const after = await swapAndRedeemInHalfLife(period, numberToWei(2.5), numberToWei(0.5))
        const expectRatio = (1 - 0.5) / (1 - 0.5 ** period)

        expect(Number(weiToNumber(origin.longFee) / Number(weiToNumber(after.longFee)))).to.be.closeTo(expectRatio, 0.000001)
        expect(Number(weiToNumber(origin.shortFee) / Number(weiToNumber(after.shortFee)))).to.be.closeTo(expectRatio, 0.000001)
      }

      async function compareMuchMoreShort(period) {
        const origin = await swapAndRedeemInHalfLife(1, numberToWei(0.5), numberToWei(2.5))
        const after = await swapAndRedeemInHalfLife(period, numberToWei(0.5), numberToWei(2.5))
        const expectRatio = (1 - 0.5) / (1 - 0.5 ** period)

        expect(Number(weiToNumber(origin.longFee) / Number(weiToNumber(after.longFee)))).to.be.closeTo(expectRatio, 0.000001)
        expect(Number(weiToNumber(origin.shortFee) / Number(weiToNumber(after.shortFee)))).to.be.closeTo(expectRatio, 0.000001)
      }

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
        swapAndRedeemInHalfLife,
        compareBalance,
        compareMuchMoreLong,
        compareMuchMoreShort,
        swapAndWait,
        instantSwapBackUTR,
        groupSwapBack,
        instantSwapBackNonUTR,
        swapBackInAHalfLife
      }
    }

    describe("Pool", function () {
      it("LP increase over time", async function () {
        const { swapAndRedeemInHalfLife, accountA, txSignerA, derivable1155, C_ID } = await loadFixture(deployDDLv2);
        const lpAmount = await derivable1155.balanceOf(accountA.address, C_ID)
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
        expect(afterLPValue).to.be.gt(originLPValue)
      })
      describe("Pool balance:", function () {
        it("swap back after 1 halflife", async function () {
          const { swapBackInAHalfLife } = await loadFixture(deployDDLv2)
          await swapBackInAHalfLife(numberToWei(0.5), numberToWei(0.5), "Pool balance")
        })
        it("1 day - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(86400, HALF_LIFE, numberToWei(0.5), numberToWei(0.5))
        })
        it("1 month - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(30 * 86400, HALF_LIFE, numberToWei(0.5), numberToWei(0.5))
        })
        it("1 day - wait 10 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(86400, 3.14 * HALF_LIFE, numberToWei(0.5), numberToWei(0.5))
        })
        it("wait, after", async function () {
          // TODO: Zergity
          const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
          // await time.increase(3.14 * HALF_LIFE)
          const after = await swapAndRedeemInHalfLife(0, numberToWei(1), numberToWei(1))
          expect(Number(weiToNumber(after.long))).to.be.closeTo(1, 0.01)
          expect(Number(weiToNumber(after.short))).to.be.closeTo(1, 0.01)
        })

        it("Decay same range, different time", async function () {
          const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
          const before = await swapAndRedeemInHalfLife(0.1, numberToWei(1), numberToWei(1))
          if (HALF_LIFE > 0)
            await time.increase(3.14 * HALF_LIFE)
          const after = await swapAndRedeemInHalfLife(0.1, numberToWei(1), numberToWei(1))
          expect(Number(weiToNumber(before.long))).to.be.closeTo(
            Number(weiToNumber(after.long)),
            0.0000001
          )
          expect(Number(weiToNumber(before.short))).to.be.closeTo(
            Number(weiToNumber(after.short)),
            0.0000001
          )
        })

      })

      describe("Pool long > R/2:", function () {
        it("swap back after 1 halflife", async function () {
          const { swapBackInAHalfLife } = await loadFixture(deployDDLv2)
          await swapBackInAHalfLife(numberToWei(2.5), numberToWei(0.5), "Pool long > R/2")
        })
        it("1 day - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(86400, HALF_LIFE, numberToWei(2.5), numberToWei(0.5))
        })
        it("1 month - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(30 * 86400, HALF_LIFE, numberToWei(2.5), numberToWei(0.5))
        })
        it("1 day - wait 10 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(86400, 3.14 * HALF_LIFE, numberToWei(2.5), numberToWei(0.5))
        })
        it("Instant swap back", async function () {
          const { instantSwapBackUTR } = await loadFixture(deployDDLv2)
          await instantSwapBackUTR(numberToWei(2.5), numberToWei(0.5))
        })
        it("Decay same range, different time", async function () {
          const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
          const before = await swapAndRedeemInHalfLife(0.1, numberToWei(2.5), numberToWei(0.5))
          if (HALF_LIFE > 0)
            await time.increase(3.14 * HALF_LIFE)
          const after = await swapAndRedeemInHalfLife(0.1, numberToWei(2.5), numberToWei(0.5))
          expect(before.longFee, 'Long Return').gt(after.longFee).gt(0)
          // expect(before.short, 'Short Return').gt(after.short).gt(0)
          expect(Number(weiToNumber(before.short))).to.be.closeTo(
            Number(weiToNumber(after.short)),
            0.0000001
          )
        })
      })

      describe("Pool short > R/2:", function () {
        it("swap back after 1 halflife", async function () {
          const { swapBackInAHalfLife } = await loadFixture(deployDDLv2)
          await swapBackInAHalfLife(numberToWei(0.5), numberToWei(2.5), "Pool short > R/2")
        })
        it("1 day - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(86400, HALF_LIFE, numberToWei(0.5), numberToWei(2.5))
        })
        it("1 month - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(30 * 86400, HALF_LIFE, numberToWei(0.5), numberToWei(2.5))
        })
        it("1 day - wait 10 halflife", async function () {
          const { swapAndWait } = await loadFixture(deployDDLv2);
          await swapAndWait(86400, 3.14 * HALF_LIFE, numberToWei(0.5), numberToWei(2.5))
        })
        it("Instant swap back", async function () {
          const { instantSwapBackUTR } = await loadFixture(deployDDLv2)
          await instantSwapBackUTR(numberToWei(0.5), numberToWei(2.5))
        })
        it("Decay same range, different time", async function () {
          const { swapAndRedeemInHalfLife } = await loadFixture(deployDDLv2);
          const before = await swapAndRedeemInHalfLife(0.1, numberToWei(0.5), numberToWei(2.5))
          if (HALF_LIFE > 0)
            await time.increase(3.14 * HALF_LIFE)
          const after = await swapAndRedeemInHalfLife(0.1, numberToWei(0.5), numberToWei(2.5))
          expect(before.shortFee, 'Short Return').gt(after.shortFee).gt(0)
          // expect(before.long, 'Long Return').gt(after.long).gt(0)
          expect(Number(weiToNumber(before.long))).to.be.closeTo(
            Number(weiToNumber(after.long)),
            0.0000001
          )
        })
        // TODO: Zergity verify this
        it("Group swap back", async function () {
          const { groupSwapBack } = await loadFixture(deployDDLv2)
          await groupSwapBack(numberToWei(2.5), numberToWei(2.5))
        })
        it("Instant swap back", async function () {
          const { instantSwapBackNonUTR } = await loadFixture(deployDDLv2)
          await instantSwapBackNonUTR(numberToWei(2.5), numberToWei(0.5))
        })
      })
    });
  })
})


