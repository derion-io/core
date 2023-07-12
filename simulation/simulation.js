const fs = require('fs')
const csv = require("@fast-csv/parse");
const { loadFixtureFromParams } = require('../test/shared/scenerios')
const { baseParams } = require('../test/shared/baseParams')
const { bn, numberToWei, swapToSetPriceMock } = require('../test/shared/utilities')
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers')
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require('../test/shared/constant');
const { MaxUint256, AddressZero } = ethers.constants

const SECONDS_PER_DAY = 86400

function toHalfLife(dailyRate) {
  return dailyRate == 0 ? 0 : (SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate))).toFixed(0)
}

const interestRates = [0.03, 0.3]

interestRates.forEach(rate => {
  describe(`Simulation with rate: ${rate}`, function() {
    const hl = toHalfLife(rate)
    const fixture = loadFixtureFromParams([{
      ...baseParams,
      halfLife: bn(hl)
    }], { 
      feeRate: 12,
      callback: async function({derivablePools}) {
        const pool = derivablePools[0]
        await pool.swap(
          SIDE_R,
          SIDE_C,
          numberToWei(9995),
          0
        )
      }
    })
    it('Test', async function () {
      const {derivablePools, usdc, weth, uniswapPair, derivable1155} = await loadFixture(fixture)
      const pool = derivablePools[0]
      const data = await readCsv(
        `${__dirname}/data/sample.csv`,
        { skipRows: 1 },
        (row) => ({
          timestamp: row[0], 
          account: row[1], 
          isLong: row[2], 
          ethAmount: row[3], 
          spotPrice: row[4], 
          twapPrice: row[5], 
          isOpen: row[6]
        })
      )
      const startRealTimestamp = await time.latest()
      const firstTimestamp = parseInt(data[0].timestamp)

      for (const order of data) {
        const accounts = {}
        let account = accounts[order.account]
        if (!account) {
          account = await generateRandomWallet()
          await time.setNextBlockTimestamp(startRealTimestamp + ellapsed)
          await weth.connect(account).deposit({
            value: numberToWei(50)
          })

          await time.setNextBlockTimestamp(startRealTimestamp + ellapsed)
          await weth.connect(account).approve(pool.contract.address, MaxUint256)

          await time.setNextBlockTimestamp(startRealTimestamp + ellapsed)
          await derivable1155.connect(account).setApprovalForAll(pool.contract.address, true);
        }

        const ellapsed = parseInt(order.timestamp) - firstTimestamp
        const side = order.isLong ? SIDE_A : SIDE_B
        const sideIn = order.isOpen ? SIDE_R : side
        const sideOut = order.isOpen ? side : SIDE_R

        await time.setNextBlockTimestamp(startRealTimestamp + ellapsed)
        await swapToSetPriceMock({
          quoteToken: usdc,
          baseToken: weth,
          uniswapPair,
          targetSpot: order.spotPrice,
          targetTwap: order.twapPrice
        })
        await time.setNextBlockTimestamp(startRealTimestamp + ellapsed)
        await pool.connect(account).swap(
          sideIn,
          sideOut,
          numberToWei(order.ethAmount),
          0
        )
      }
    })
  })
})

function readCsv(path, options, rowProcessor) {
  return new Promise((resolve, reject) => {
    const data = [];
    csv
      .parseFile(path, options)
      .on("error", reject)
      .on("data", (row) => {
        const obj = rowProcessor(row);
        if (obj) data.push(obj);
      })
      .on("end", () => {
        resolve(data);
      });
  });
}

async function generateRandomWallet() {
  // Connect to Hardhat Provider
  const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
  // Set balance
  await ethers.provider.send("hardhat_setBalance", [
      wallet.address,
      "0x56BC75E2D63100000", // 100 ETH
  ]);
  return wallet;
}

