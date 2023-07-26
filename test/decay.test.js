const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { _selectPrice, _evaluate } = require("./shared/AsymptoticPerpetual");
const { weiToNumber, paramToConfig, bn, numberToWei, packId, encodePayload } = require("./shared/utilities");
const { SIDE_C, SIDE_R, SIDE_A, SIDE_B } = require("./shared/constant");
const { ethers } = require("hardhat");

use(solidity)

const opts = {
  gasLimit: 30000000
}

const PAYMENT       = 0;
const HLs = [ 10 * 365 * 24 * 60 * 60]

HLs.forEach(HALF_LIFE => {
  describe(`HALF_LIFE ${HALF_LIFE == 0 ? '= 0' : '> 0'} Decay funding rate`, function () {
    const fixture = loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(HALF_LIFE)
    }], {
      callback: async ({weth, utr, derivable1155, stateCalHelper, owner, derivablePools, accountA, accountB}) => {
        const pool = derivablePools[0]
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

        const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
        const derivableHelper = await DerivableHelper.deploy(
          pool.contract.address,
          derivable1155.address,
          stateCalHelper.address
        )
        await derivableHelper.deployed()

        const A_ID = packId(SIDE_A, pool.contract.address);
        const B_ID = packId(SIDE_B, pool.contract.address);
        const C_ID = packId(SIDE_C, pool.contract.address);

        txSignerA = weth.connect(accountA);
        txSignerB = weth.connect(accountB);
        await txSignerA.approve(pool.contract.address, '100000000000000000000000000');
        await txSignerB.approve(pool.contract.address, '100000000000000000000000000');
        txSignerA = derivable1155.connect(accountA);
        await txSignerA.setApprovalForAll(pool.contract.address, true);
        txSignerB = derivable1155.connect(accountB);
        await txSignerB.setApprovalForAll(pool.contract.address, true);
        txSignerA = pool.connect(accountA);
        txSignerB = pool.connect(accountB);
        
        await txSignerA.swap(
          SIDE_R,
          SIDE_C,
          numberToWei(1),
          0,
          {
              recipient: accountA.address
          }
        )

        async function swapAndWait(period, waitingTime, amountA, amountB) {
          await txSignerA.swap(
            SIDE_R,
            SIDE_A,
            amountA,
            0,
            {
                recipient: accountA.address
            }
          )
          await txSignerB.swap(
            SIDE_R,
            SIDE_B,
            amountB,
            0,
            {
                recipient: accountB.address
            }
          )
          const aTokenAmount = await derivable1155.balanceOf(accountA.address, A_ID)
          const bTokenAmount = await derivable1155.balanceOf(accountB.address, B_ID)
          const aFirstBefore = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const bFirstBefore = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true, recipient: accountB.address }
          )
          if (period > 0)
            await time.increase(period)
          
          const aFirstAfter = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const bFirstAfter = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true, recipient: accountB.address }
          )

          if (waitingTime > 0)
            await time.increase(waitingTime)
          const aSecondBefore = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const bSecondBefore = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true, recipient: accountB.address }
          )
          if (period > 0)
            await time.increase(period)
          const aSecondAfter = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const bSecondAfter = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true, recipient: accountB.address }
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
          const pTxA = await pool.connect(accountA).swap(
            SIDE_R,
            SIDE_A,
            amountA,
            0,
            {
              populateTransaction: true,
              recipient: derivableHelper.address,
              payer: accountA.address
            }
          )
          await txSignerA.exec([],
            [
              {
                inputs: [{
                  mode: PAYMENT,
                  eip: 20,
                  token: weth.address,
                  id: 0,
                  amountIn: amountA,
                  recipient: pool.contract.address,
                }],
                code: pool.contract.address,
                data: pTxA.data,
              },
              {
                inputs: [],
                code: derivableHelper.address,
                data: (await derivableHelper.populateTransaction.swapInAll(
                  SIDE_A,
                  SIDE_R,
                  0,
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
          const pTxB = await pool.connect(accountB).swap(
            SIDE_R,
            SIDE_B,
            amountB,
            0,
            {
              populateTransaction: true,
              recipient: derivableHelper.address,
              payer: accountB.address
            }
          )
          await txSignerB.exec([],
            [
              {
                inputs: [{
                  mode: PAYMENT,
                  eip: 20,
                  token: weth.address,
                  id: 0,
                  amountIn: amountB,
                  recipient: pool.contract.address,
                }],
                code: pool.contract.address,
                data: pTxB.data,
              },
              {
                inputs: [],
                code: derivableHelper.address,
                data: (await derivableHelper.populateTransaction.swapInAll(
                  SIDE_B,
                  SIDE_R,
                  0,
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
          const ptxAmountB = await pool.connect(accountA).swap(
            SIDE_R,
            SIDE_B,
            amountB,
            0,
            {
              populateTransaction: true,
              recipient: derivableHelper.address,
              payer: accountA.address
            }
          )
          const ptxAmountA = await pool.connect(accountA).swap(
            SIDE_R,
            SIDE_A,
            amountA,
            0,
            {
              populateTransaction: true,
              recipient: derivableHelper.address,
              payer: accountA.address
            }
          )
          await txSignerA.exec([],
            [
              {
                inputs: [{
                  mode: PAYMENT,
                  eip: 20,
                  token: weth.address,
                  id: 0,
                  amountIn: amountB,
                  recipient: pool.contract.address,
                }],
                code: pool.contract.address,
                data: ptxAmountB.data,
              },
              {
                inputs: [{
                  mode: PAYMENT,
                  eip: 20,
                  token: weth.address,
                  id: 0,
                  amountIn: amountA,
                  recipient: pool.contract.address,
                }],
                code: pool.contract.address,
                data: ptxAmountA.data,
              },
              {
                inputs: [],
                code: derivableHelper.address,
                data: (await derivableHelper.populateTransaction.swapInAll(
                  SIDE_A,
                  SIDE_R,
                  0,
                  ethers.constants.AddressZero,
                  accountA.address
                )).data,
              },
              {
                inputs: [],
                code: derivableHelper.address,
                data: (await derivableHelper.populateTransaction.swapInAll(
                  SIDE_B,
                  SIDE_R,
                  0,
                  ethers.constants.AddressZero,
                  accountB.address
                )).data,
              }
            ], opts)
          const afterA = await weth.balanceOf(accountA.address)
          const afterB = await weth.balanceOf(accountB.address)
          const changeOfA = beforeA.sub(afterA)
          const changeOfB = afterB.sub(beforeB)
          expect(weiToNumber(amountA)/weiToNumber(changeOfA)).closeTo(1, 0.00000000001)
          expect(weiToNumber(amountB)/weiToNumber(changeOfB)).closeTo(1, 0.00000000001)
        }

        async function instantSwapBackNonUTR(amountA, amountB) {
          txSignerA = pool.connect(accountA)
          await txSignerA.swap(
            SIDE_R,
            SIDE_A,
            amountA,
            0
          )
          const aTokenAmount = await derivable1155.balanceOf(accountA.address, A_ID)
          const valueA = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true }
          )
          txSignerB = pool.connect(accountB)
          await txSignerB.swap(
            SIDE_R,
            SIDE_B,
            amountB,
            0
          )
          const bTokenAmount = await derivable1155.balanceOf(accountB.address, B_ID)
          const valueB = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true }
          )
          expect(amountA.gte(valueA)).to.be.true
          expect(amountB.gte(valueB)).to.be.true
        }

        async function swapBackInAHalfLife(amountA, amountB, caseName) {
          txSignerA = pool.connect(accountA)
          await txSignerA.swap(
            SIDE_R,
            SIDE_A,
            amountA,
            0,
            { recipient: accountA.address }
          )
          txSignerB = pool.connect(accountB)
          await txSignerB.swap(
            SIDE_R,
            SIDE_B,
            amountB,
            0,
            { recipient: accountB.address }
          )

          const aTokenAmount = await derivable1155.balanceOf(accountA.address, A_ID)
          const bTokenAmount = await derivable1155.balanceOf(accountB.address, B_ID)
          const valueABefore = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const valueBBefore = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true, recipient: accountB.address }
          )
          if (HALF_LIFE > 0)
            await time.increase(HALF_LIFE)
          const valueAAfter = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const valueBAfter = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { static: true, recipient: accountB.address }
          )
          // Check lớn hơn 0 và < 1
          let expectedValueAAfter = valueABefore.div(2)
          let expectedValueBAfter = valueBBefore.div(2)
          if (HALF_LIFE == 0) {
            expectedValueAAfter = valueABefore
            expectedValueBAfter = valueBBefore
          }
          
          expect(Number(numberToWei(expectedValueAAfter))).to.be.closeTo(
            Number(numberToWei(valueAAfter)),
            1e18,
            `${caseName}: Value long should be half after halflife`
          )

          expect(Number(numberToWei(expectedValueBAfter))).to.be.closeTo(
            Number(numberToWei(valueBAfter)),
            1e18,
            `${caseName}: Value long should be half after halflife`
          )
        }

        async function swapAndRedeemInHalfLife(period, amountA, amountB) {
          txSignerA = pool.connect(accountA)
          txSignerB = pool.connect(accountB)

          await txSignerA.swap(
            SIDE_R,
            SIDE_A,
            amountA,
            0,
            { recipient: accountA.address }
          )
          await txSignerB.swap(
            SIDE_R,
            SIDE_B,
            amountB,
            0,
            { recipient: accountB.address }
          )

          const aTokenAmount = await derivable1155.balanceOf(accountA.address, A_ID)
          const bTokenAmount = await derivable1155.balanceOf(accountB.address, B_ID)
          
          const valueABefore = await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountA.address }
          )
          const valueBBefore = await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            aTokenAmount,
            0,
            { static: true, recipient: accountB.address }
          )
          if (period != 0 && HALF_LIFE > 0) {
            console.log(` Wait ${period} HL`)
            await time.increase(period * HALF_LIFE)
          }

          const aBefore = await weth.balanceOf(accountA.address)
          const bBefore = await weth.balanceOf(accountB.address)

          await txSignerA.swap(
            SIDE_A,
            SIDE_R,
            aTokenAmount,
            0,
            { recipient: accountA.address }
          )
          await txSignerB.swap(
            SIDE_B,
            SIDE_R,
            bTokenAmount,
            0,
            { recipient: accountB.address }
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
          A_ID,
          B_ID,
          C_ID,
          derivableHelper,
          txSignerA,
          txSignerB,
          pool,
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
    })

    describe("Pool", function () {
      it("LP increase over time", async function () {
        const { swapAndRedeemInHalfLife, accountA, txSignerA, derivable1155, C_ID, pool, oracleLibrary, params } = await loadFixture(fixture);
        const lpAmount = await derivable1155.balanceOf(accountA.address, C_ID)
        const state = await pool.contract.getStates()
        const config = paramToConfig(params[0])
        const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
        const price = _selectPrice(
          config,
          state,
          {min: oraclePrice.spot, max: oraclePrice.twap},
          SIDE_R,
          SIDE_B,
          bn(await time.latest())
        )
        const totalSupply = await derivable1155.totalSupply(C_ID)

        const eval = _evaluate(price.market, state)

        const positionReserved = eval.rA.add(eval.rB).add(numberToWei(2))
        const originLPValue = await txSignerA.swap(
          SIDE_C,
          SIDE_R,
          lpAmount,
          0,
          {
            static: true,
            recipient: accountA.address
          }
        )
        await swapAndRedeemInHalfLife(1, numberToWei(1), numberToWei(1))
        const afterLPValue = await txSignerA.swap(
          SIDE_C,
          SIDE_R,
          lpAmount,
          0,
          { static: true, recipient: accountA.address }
        )
        const expectedValue = originLPValue.add(positionReserved.div(2).mul(lpAmount).div(totalSupply))
        expect(Number(weiToNumber(afterLPValue))/Number(weiToNumber(expectedValue))).to.be.closeTo(1, 1e-3)
      })
      describe("Pool balance:", function () {
        it("swap back after 1 halflife", async function () {
          const { swapBackInAHalfLife } = await loadFixture(fixture)
          await swapBackInAHalfLife(numberToWei(0.5), numberToWei(0.5), "Pool balance")
        })
        it("1 day - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(86400, HALF_LIFE, numberToWei(0.5), numberToWei(0.5))
        })
        it("1 month - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(30 * 86400, HALF_LIFE, numberToWei(0.5), numberToWei(0.5))
        })
        it("1 day - wait 10 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(86400, 3.14 * HALF_LIFE, numberToWei(0.5), numberToWei(0.5))
        })
        it("wait, after", async function () {
          const { swapAndRedeemInHalfLife } = await loadFixture(fixture);
          const after = await swapAndRedeemInHalfLife(0, numberToWei(1), numberToWei(1))
          expect(Number(weiToNumber(after.long))).to.be.closeTo(1, 0.0000001)
          expect(Number(weiToNumber(after.short))).to.be.closeTo(1, 0.0000001)
        })
        it("Open Long does not affect C value", async function() {
          const {pool, derivable1155, owner, C_ID} = await loadFixture(fixture)
          const balanceBefore = await derivable1155.balanceOf(owner.address, C_ID)

          await pool.swap(
            SIDE_R, 
            SIDE_C,
            numberToWei(5),
            0
          )

          const lpAmount = (await derivable1155.balanceOf(owner.address, C_ID)).sub(balanceBefore)
          await time.increase(HALF_LIFE)
          const lpValueBefore = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )

          // Big swap
          await pool.swap(
            SIDE_R, 
            SIDE_A,
            numberToWei(5), 
            0
          )
          
          const lpValueAfter = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )
          expect(Number(weiToNumber(lpValueBefore))/Number(weiToNumber(lpValueAfter))).to.be.closeTo(1, 1e-5)
        })

        it("Open Short does not affect C value", async function() {
          const {pool, derivable1155, owner, C_ID} = await loadFixture(fixture)
          const balanceBefore = await derivable1155.balanceOf(owner.address, C_ID)

          await pool.swap(
            SIDE_R, 
            SIDE_C,
            numberToWei(5),
            0
          )

          const lpAmount = (await derivable1155.balanceOf(owner.address, C_ID)).sub(balanceBefore)
          await time.increase(HALF_LIFE)
          const lpValueBefore = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )

          // Big swap
          await pool.swap(
            SIDE_R, 
            SIDE_B,
            numberToWei(5), 
            0
          )
          
          const lpValueAfter = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )
          expect(Number(weiToNumber(lpValueBefore))/Number(weiToNumber(lpValueAfter))).to.be.closeTo(1, 1e-3)
        })

        it("Close Long does not affect C value", async function() {
          const {pool, derivable1155, owner, C_ID, A_ID} = await loadFixture(fixture)
          const balanceBefore = await derivable1155.balanceOf(owner.address, C_ID)
          const balancePositionBefore = await derivable1155.balanceOf(owner.address, A_ID)

          await pool.swap(
            SIDE_R, 
            SIDE_C,
            numberToWei(5),
            0
          )

          await pool.swap(
            SIDE_R, 
            SIDE_A,
            numberToWei(5), 
            0
          )

          const positionAmount = (await derivable1155.balanceOf(owner.address, A_ID)).sub(balancePositionBefore)
          const lpAmount = (await derivable1155.balanceOf(owner.address, C_ID)).sub(balanceBefore)
          await time.increase(HALF_LIFE)
          const lpValueBefore = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )

          // Big swap
          await pool.swap(
            SIDE_A,
            SIDE_R, 
            positionAmount,
            0
          )
          
          const lpValueAfter = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )
          expect(Number(weiToNumber(lpValueBefore))/Number(weiToNumber(lpValueAfter))).to.be.closeTo(1, 1e-3)
        })

        it("Close Short does not affect C value", async function() {
          const {pool, derivable1155, owner, C_ID, B_ID} = await loadFixture(fixture)
          const balanceBefore = await derivable1155.balanceOf(owner.address, C_ID)
          const balancePositionBefore = await derivable1155.balanceOf(owner.address, B_ID)

          await pool.swap(
            SIDE_R, 
            SIDE_C,
            numberToWei(5),
            0
          )

          await pool.swap(
            SIDE_R, 
            SIDE_B,
            numberToWei(5),
            0
          )

          const positionAmount = (await derivable1155.balanceOf(owner.address, B_ID)).sub(balancePositionBefore)
          const lpAmount = (await derivable1155.balanceOf(owner.address, C_ID)).sub(balanceBefore)
          await time.increase(HALF_LIFE)
          const lpValueBefore = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )

          // Big swap
          await pool.swap(
            SIDE_B,
            SIDE_R, 
            positionAmount, 
            0
          )
          
          const lpValueAfter = await pool.swap(
            SIDE_C, 
            SIDE_R,
            lpAmount,
            0,
            { static: true }
          )
          expect(Number(weiToNumber(lpValueBefore))/Number(weiToNumber(lpValueAfter))).to.be.closeTo(1, 1e-3)
        })
      })

      describe("Pool long > R/2:", function () {
        it("swap back after 1 halflife", async function () {
          const { swapBackInAHalfLife } = await loadFixture(fixture)
          await swapBackInAHalfLife(numberToWei(2.5), numberToWei(0.5), "Pool long > R/2")
        })
        it("1 day - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(86400, HALF_LIFE, numberToWei(2.5), numberToWei(0.5))
        })
        it("1 month - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(30 * 86400, HALF_LIFE, numberToWei(2.5), numberToWei(0.5))
        })
        it("1 day - wait 10 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(86400, 3.14 * HALF_LIFE, numberToWei(2.5), numberToWei(0.5))
        })
        it("Instant swap back", async function () {
          const { instantSwapBackUTR } = await loadFixture(fixture)
          await instantSwapBackUTR(numberToWei(2.5), numberToWei(0.5))
        })
      })

      describe("Pool short > R/2:", function () {
        it("swap back after 1 halflife", async function () {
          const { swapBackInAHalfLife } = await loadFixture(fixture)
          await swapBackInAHalfLife(numberToWei(0.5), numberToWei(2.5), "Pool short > R/2")
        })
        it("1 day - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(86400, HALF_LIFE, numberToWei(0.5), numberToWei(2.5))
        })
        it("1 month - wait 1 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(30 * 86400, HALF_LIFE, numberToWei(0.5), numberToWei(2.5))
        })
        it("1 day - wait 10 halflife", async function () {
          const { swapAndWait } = await loadFixture(fixture);
          await swapAndWait(86400, 3.14 * HALF_LIFE, numberToWei(0.5), numberToWei(2.5))
        })
        it("Instant swap back", async function () {
          const { instantSwapBackUTR } = await loadFixture(fixture)
          await instantSwapBackUTR(numberToWei(0.5), numberToWei(2.5))
        })
        it("Group swap back", async function () {
          const { groupSwapBack } = await loadFixture(fixture)
          await groupSwapBack(numberToWei(2.5), numberToWei(2.5))
        })
        it("Instant swap back", async function () {
          const { instantSwapBackNonUTR } = await loadFixture(fixture)
          await instantSwapBackNonUTR(numberToWei(2.5), numberToWei(0.5))
        })
      })
    });
  })
})


