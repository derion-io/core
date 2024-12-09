// @ts-nocheck
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

const { loadFixtureFromParams } = require("./shared/scenerios");
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant");
const { baseParams } = require("./shared/baseParams");
const {
  weiToNumber,
  bn,
  numberToWei,
  paramToConfig,
  packId,
} = require("./shared/utilities");

const INTEREST_HLS = [0, 1, 60, 60 * 60, 1024, 60*60*24*365*1000000]
const PREMIUM_HLS = [0, 1, 60, 60 * 60, 1024, 60*60*24*365*10]

INTEREST_HLS.forEach(INTEREST_HL => {
  PREMIUM_HLS.forEach(PREMIUM_HL => {
    describe("High Interest and Premium", function () {
      describe(`I = ${INTEREST_HL}, P = ${PREMIUM_HL}`, async function () {
        const fixture = await loadFixtureFromParams([
          {
            ...baseParams,
            halfLife: bn(INTEREST_HL),
            premiumHL: bn(PREMIUM_HL),
          },
        ]);

        async function openAndClosePosition(side, amount, period) {
          const { derivablePools, derivable1155, accountA } = await loadFixture(
            fixture
          );
          const pool = derivablePools[0].connect(accountA);
          await pool.swap(SIDE_R, side, numberToWei(amount));
          const balance = await derivable1155.balanceOf(
            accountA.address,
            packId(SIDE_A, pool.contract.address)
          );

          await time.increase(period);

          await pool.swap(side, SIDE_R, balance);
        }

        it("Open long and close: 1e - 1 day", async function () {
          await openAndClosePosition(SIDE_A, 1, 86400);
        });

        it("Open short and close: 1e - 1 day", async function () {
          await openAndClosePosition(SIDE_B, 1, 86400);
        });

        it("Open LP and close: 1e - 1 day", async function () {
          await openAndClosePosition(SIDE_C, 1, 86400);
        });

        it("Open LP and close: 1e - 1 second", async function () {
          await openAndClosePosition(SIDE_C, 1, 1);
        });
      });
    });
  })
})
