const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { baseParams } = require("./shared/baseParams");
const { ethers } = require("hardhat");
const { numberToWei } = require("./shared/utilities");
const { SIDE_A } = require("./shared/constant");

const PAYMENT = 0;

describe("Helper v2", function () {
  const fixture = loadFixtureFromParams(
    [
      baseParams
    ],
    {
      useLPAsReserve: true,
      callback: async ({ weth }) => {
        const UniV2LPHelper = await ethers.getContractFactory("UniV2LPHelper")
        const uniV2LPHelper = await UniV2LPHelper.deploy(
          weth.address
        )
        return { uniV2LPHelper }
      }
    }
  );

  it("Mint LP and open", async function () {
    const {
      utr,
      reserveToken,
      weth,
      stateCalHelper,
      uniV2LPHelper,
      usdc,
      owner,
      derivablePools,
    } = await loadFixture(fixture);
    const pool = derivablePools[0];
    await usdc.approve(utr.address, ethers.constants.MaxUint256);
    await weth.approve(utr.address, ethers.constants.MaxUint256);
    await utr.exec(
      [],
      [
        {
          inputs: [
            {
              mode: PAYMENT,
              eip: 20,
              token: usdc.address,
              id: 0,
              amountIn: numberToWei(1500),
              recipient: reserveToken,
            },
            {
              mode: PAYMENT,
              eip: 20,
              token: weth.address,
              id: 0,
              amountIn: numberToWei(1),
              recipient: reserveToken,
            },
            {
              mode: PAYMENT,
              eip: 20,
              token: reserveToken,
              id: 0,
              amountIn: numberToWei(1000),
              recipient: pool.contract.address,
            },
          ],
          flags: 0,
          code: uniV2LPHelper.address,
          data: (
            await uniV2LPHelper.populateTransaction.mintLPV2AndOpen(
              {
                mintParams: {
                  pair: reserveToken,
                  mainToken: usdc.address,
                  otherToken: weth.address,
                  amountMainDesired: numberToWei(10),
                  amountOtherToMintFirst: 0,
                  fee10000: 30
                },
                side: SIDE_A,
                deriPool: pool.contract.address,
                recipient: owner.address,
                stateCalHelper: stateCalHelper.address,
                payer: owner.address,
                INDEX_R: 0
              }
            )
          ).data,
        },
      ]
    );
  });

  // it("Test", async function () {
  //   const { derivablePools } = await loadFixture(fixture)
  //   const pool = derivablePools[0]
  //   console.log(pool)
  // })
});
