// @ts-nocheck
const { expect } = require("chai")
const { stringify } = require ("mocha/lib/utils");
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant");
const { baseParams } = require("./shared/baseParams");
const {
  weiToNumber,
  bn,
  numberToWei,
  paramToConfig,
  packId,
} = require("./shared/utilities");

const PRECISION = 1000000 

const INTEREST_HLS = [1, 60*60, 60*60*24]
const PREMIUM_HLS = [0, 60, 60*60]

INTEREST_HLS.forEach(INTEREST_HL => {
  PREMIUM_HLS.forEach(PREMIUM_HL => {
    describe("Convergence", function () {
      if (INTEREST_HL == 0 && PREMIUM_HL == 0) {
        return
      }
      describe(`I = ${INTEREST_HL}, P = ${PREMIUM_HL}`, async function () {
        const fixture = await loadFixtureFromParams([{
          ...baseParams,
          halfLife: bn(INTEREST_HL),
          premiumHL: bn(PREMIUM_HL),
        }], {
          logicName: "View",
        });

        async function converge(pa = 1, pb = 1, pc = 1, swap = false) {
          const { derivablePools, derivable1155, feeRate, owner } = await loadFixture(
            fixture
          );
          const pool = derivablePools[0];

          async function setSideRate(side, p) {
            if (p >= 1) {
              return
            }
            const balance = await derivable1155.balanceOf(
              owner.address,
              packId(side, pool.contract.address)
            )
            let amount = balance.mul(Math.round(PRECISION*(1-p))).div(PRECISION)
            // if (balance.sub(amount).lt(1000)) {
            //   amount = balance.sub(1000)
            // }
            return pool.swap(side, SIDE_R, amount)
          }
  
          await Promise.all([
            setSideRate(SIDE_A, pa),
            setSideRate(SIDE_B, pb),
            setSideRate(SIDE_C, pc),
          ])

          const anchor = await time.latest() + 10

          let rate
          const view = []
          for (let i = 0; i < 15; ++i) {
            if (i > 0) {
              const nextTime = anchor + ((PREMIUM_HL + INTEREST_HL) << (i+1))
              if (i == 1) {
                await time.increaseTo(anchor)
                const { rA, rB } = await pool.contract.callStatic.compute(derivable1155.address, feeRate, 0, 0)
                if (pa > pb) {
                  rate = view[0].rA.sub(rA).mul(PRECISION).div(view[0].rA.sub(view[0].rB)).toNumber() / (PRECISION << i)
                } else {
                  rate = view[0].rB.sub(rB).mul(PRECISION).div(view[0].rB.sub(view[0].rA)).toNumber() / (PRECISION << i)
                }
              }
              await time.increaseTo(nextTime)
              if (swap) {
                const { rA, rB, rC } = await pool.contract.callStatic.compute(derivable1155.address, feeRate, 0, 0)
                if (rA.gte(rB) && rA.gte(rC)) {
                  await pool.swap(SIDE_R, SIDE_A, 1)
                } else if (rB.gte(rA) && rB.gte(rC)) {
                  await pool.swap(SIDE_R, SIDE_B, 1)
                } else {
                  await pool.swap(SIDE_R, SIDE_C, 1)
                }
              }
            }
            const { rA, rB, rC } = await pool.contract.callStatic.compute(derivable1155.address, feeRate, 0, 0)
            view.push({ rA, rB, rC })

            if (rA.sub(rB).abs().lte(rA.div(1000))) {
              break;
            }
          }
          return [view, rate]
        }

        function deviation(a, b) {
          const m = a.add(b).shr(1)
          return a.sub(b).mul(PRECISION).div(m).toNumber() / PRECISION
        }

        async function testConvergence(a, b, c) {
          it(`convergence ${a}  ${b}  ${c}`, async function () {
            const [view, viewRate] = await converge(a, b, c);
            // console.log(view.length, viewRate*100, '%')

            const [swap, swapRate] = await converge(a, b, c, true);
            // expect(view.length).eq(swap.length)
            // if (!(swapRate > 0)) {
            //   expect(viewRate == swapRate)
            // } else {
            //   expect(viewRate/swapRate).closeTo(1, 0.1)
            // }
            let totalDeviation = 0
            const n = Math.min(view.length, swap.length)
            // ignore the first items
            for (let i = 1; i < n; ++i) {
              console.log(i, view[i].rA.toString(), view[i].rB.toString(), view[i].rC.toString())
              console.log(i, swap[i].rA.toString(), swap[i].rB.toString(), swap[i].rC.toString())
              totalDeviation += deviation(view[i].rA, swap[i].rA) / 2**(n-1-i)
              totalDeviation += deviation(view[i].rB, swap[i].rB) / 2**(n-1-i)
              totalDeviation += deviation(view[i].rC, swap[i].rC) / 2**(n-1-i)
            }
            // console.log(totalDeviation)
            console.log('deviation', totalDeviation)
            expect(Math.abs(totalDeviation)).lte(0.05, `avg deviation too high`)
          })
        }

        testConvergence(0, 0, 1)
        testConvergence(0, 1, 0)
        testConvergence(0.5, 1, 0.5)
        testConvergence(1, 1, 0)
        testConvergence(0, 0.5, 1)

        testConvergence(0.7, 0.2, 0)
        testConvergence(0.7, 0.2, 0.1)
        testConvergence(0.7, 0.2, 0.5)
        testConvergence(0.7, 0.2, 1)

        testConvergence(0.6, 0.1, 0)
        testConvergence(0.6, 0.1, 0.1)
        testConvergence(0.6, 0.1, 0.5)
        testConvergence(0.6, 0.1, 1)

        testConvergence(0.5, 0, 0)
        testConvergence(0.5, 0, 0.1)
        testConvergence(0.5, 0, 0.5)
        testConvergence(0.5, 0, 1)

      });
    });
  })
})

