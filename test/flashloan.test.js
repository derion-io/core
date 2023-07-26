const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { ethers } = require("hardhat")
const { _init } = require("./shared/AsymptoticPerpetual")
const { baseParams } = require("./shared/baseParams")
const { SIDE_R, SIDE_C, SIDE_A, SIDE_B } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt, encodePayload, weiToNumber, attemptSwap, feeToOpenRate, getSqrtPriceFromPrice } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
  gasLimit: 30000000
}

const FROM_ROUTER = 10;
const PAYMENT = 0;
const TRANSFER = 1;
const ALLOWANCE = 2;
const CALL_VALUE = 3;

const EIP_ETH = 0
const ERC_721_BALANCE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ERC_721_BALANCE"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Flashloan spec", function () {
  const fixture = loadFixtureFromParams([baseParams], {
    callback: async function({derivablePools, uniswapPair}) {
      const pool = derivablePools[0]
      await pool.swap(
        SIDE_R,
        SIDE_C,
        numberToWei(9995),
      )

      const FlashloanAttack = await ethers.getContractFactory('FlashloanAttack');
      const flashloan = await FlashloanAttack.deploy(uniswapPair.address, pool.contract.address)

      return { flashloan }
    }
  })

  describe("Pool", function () {
    describe("Flashloan", function () {
      it("Long", async function () {
        const { owner, weth, usdc, derivablePools, derivable1155, flashloan } = await loadFixture(fixture)
        const pool = derivablePools[0]

        const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_A, pool.contract.address))
        await pool.swap(
          SIDE_R,
          SIDE_A,
          numberToWei(1),
        )
       
        const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_A, pool.contract.address))
        const positionAmount = tokenAfter.sub(tokenBefore)
        
        const normalAmount = await pool.swap(
          SIDE_A,
          SIDE_R,
          positionAmount,
          { static: true }
        )

        await derivable1155.safeTransferFrom(
          owner.address,
          flashloan.address,
          packId(SIDE_A, pool.contract.address),
          positionAmount,
          0x0
        )

        const wethBefore = await weth.balanceOf(owner.address)
        
        await flashloan.attack(
          getSqrtPriceFromPrice(usdc, weth, 15000),
          getSqrtPriceFromPrice(usdc, weth, 1500),
          derivable1155.address,
          pool.getSwapParam(
            SIDE_A,
            SIDE_R,
            positionAmount,
            {}
          ),
          AddressZero,
          owner.address,
        )
        const wethAfter = await weth.balanceOf(owner.address)
        
        expect(Number(weiToNumber(wethAfter.sub(wethBefore)))).to.be.closeTo(Number(weiToNumber(normalAmount)), 0.0001)
      })

      it("Short", async function () {
        const { owner, weth, usdc, derivablePools, derivable1155, flashloan } = await loadFixture(fixture)
        const pool = derivablePools[0]

        const tokenBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
        await pool.swap(
          SIDE_R,
          SIDE_B,
          numberToWei(1),
        )
       
        const tokenAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.contract.address))
        const positionAmount = tokenAfter.sub(tokenBefore)
        
        const normalAmount = await pool.swap(
          SIDE_B,
          SIDE_R,
          positionAmount,
          { static: true }
        )

        await derivable1155.safeTransferFrom(
          owner.address,
          flashloan.address,
          packId(SIDE_B, pool.contract.address),
          positionAmount,
          0x0
        )

        const wethBefore = await weth.balanceOf(owner.address)
        
        await flashloan.attack(
          getSqrtPriceFromPrice(usdc, weth, 150),
          getSqrtPriceFromPrice(usdc, weth, 1500),
          derivable1155.address,
          pool.getSwapParam(
            SIDE_B,
            SIDE_R,
            positionAmount,
            {}
          ),
          AddressZero,
          owner.address,
        )
        const wethAfter = await weth.balanceOf(owner.address)
        
        expect(Number(weiToNumber(wethAfter.sub(wethBefore)))).to.be.closeTo(Number(weiToNumber(normalAmount)), 0.0001)
      })
    })
  })
})
