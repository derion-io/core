const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, weiToNumber, encodePayload } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
  gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const SECONDS_PER_DAY = 86400
const DCs = [1, 25, 50, 75, 100]

function toHalfLife(dailyRate) {
  return dailyRate == 0 ? 0 : Math.round(SECONDS_PER_DAY/Math.log2(1/(1-dailyRate)))
}

function convertId(side, poolAddress) {
  switch (side) {
    case SIDE_R:
      return packId(SIDE_R, poolAddress)
    case SIDE_A:
      return packId(SIDE_A, poolAddress)
    case SIDE_B:
      return packId(SIDE_B, poolAddress)
    case SIDE_C:
      return packId(SIDE_C, poolAddress)
    default:
      return 0
  }
}

DCs.forEach(DISCOUNT_RATE => {
  describe(`Discount rate: ${DISCOUNT_RATE}%`, function () {
    async function deployDDLv2() {
      const [owner, accountA, accountB] = await ethers.getSigners()
      const signer = owner
      // deploy pool factory
      const PoolFactory = await ethers.getContractFactory("PoolFactory")
      const poolFactory = await PoolFactory.deploy(owner.address)
      // deploy UTR
      const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
      const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
      const utr = await UniversalRouter.deploy()
      await utr.deployed()
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
      // erc20 factory
      const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json")
      const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer)
      const usdc = await erc20Factory.deploy(numberToWei(10000000000))
      // uniswap factory
      const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json")
      const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer)
      const uniswapFactory = await UniswapFactory.deploy()
      //WETH
      const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
      const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer)
      const weth = await WETH.deploy()
      // uniswap router
      const compiledUniswapRouter = require("./compiled/SwapRouter.json")
      const UniswapRouter = new ethers.ContractFactory(compiledUniswapRouter.abi, compiledUniswapRouter.bytecode, signer)
      // uniswap PM
      const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json")
      const Uniswapv3PositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer)
      // setup uniswap
      const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address)
      const uniswapPositionManager = await Uniswapv3PositionManager.deploy(uniswapFactory.address, weth.address, "0x0000000000000000000000000000000000000000")
      await uniswapFactory.createPool(usdc.address, weth.address, 500)
      const compiledUniswapPool = require("./compiled/UniswapV3Pool.json")
      const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
      const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer)
      await usdc.approve(uniswapRouter.address, MaxUint256)
      await weth.approve(uniswapRouter.address, MaxUint256)
      const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
      const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
      const a = await uniswapPair.initialize(initPriceX96)
      a.wait(1)
      await time.increase(1000)
      // add liquidity
      await usdc.approve(uniswapPositionManager.address, MaxUint256)
      await weth.approve(uniswapPositionManager.address, MaxUint256)
      await uniswapPositionManager.mint({
        token0: quoteTokenIndex ? weth.address : usdc.address,
        token1: quoteTokenIndex ? usdc.address : weth.address,
        fee: 500,
        tickLower: Math.ceil(-887272 / 10) * 10,
        tickUpper: Math.floor(887272 / 10) * 10,
        amount0Desired: quoteTokenIndex ? pe("100") : pe("150000"),
        amount1Desired: quoteTokenIndex ? pe("150000") : pe("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: owner.address,
        deadline: new Date().getTime() + 100000
      }, {
        value: pe("100"),
        gasLimit: 30000000
      })
      await time.increase(1000)
      // deploy logic
      const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")
      const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
      await asymptoticPerpetual.deployed()
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
        mark: bn(38).shl(128),
        k: 5,
        a: pe(1),
        b: pe(1),
        initTime: 0,
        halfLife: toHalfLife(0.006),
        premiumRate: 0,
        minExpirationD: 0,
        minExpirationC: 0,
        discountRate: bn(DISCOUNT_RATE).shl(128).div(100)
      }
      const poolAddress = await poolFactory.computePoolAddress(params)
      await weth.deposit({
        value: pe("1000000")
      })
      await weth.transfer(poolAddress, pe("100"))
      await poolFactory.createPool(params)
      const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))

      const params1 = {
        utr: utr.address,
        token: derivable1155.address,
        logic: asymptoticPerpetual.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(38).shl(128),
        k: 6,
        a: pe(1),
        b: pe(1),
        initTime: 0,
        halfLife: toHalfLife(0.006),
        premiumRate: '0',
        minExpirationD: 24 * 60 * 60,
        minExpirationC: 12 * 60 * 60,
        discountRate: bn(DISCOUNT_RATE).shl(128).div(100)
      }
      const poolAddress1 = await poolFactory.computePoolAddress(params1)
      await weth.deposit({
        value: pe("1000000")
      })
      await weth.transfer(poolAddress1, pe("100"))
      await poolFactory.createPool(params1)
      const createPoolTimestamp = await time.latest()
      const derivablePool1 = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params1))

      // deploy helper
      const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
      const stateCalHelper = await StateCalHelper.deploy(
        derivable1155.address,
        weth.address,
      )
      await stateCalHelper.deployed()

      const DerivableHelper = await ethers.getContractFactory("contracts/test/TestHelper.sol:TestHelper")
      const derivableHelper = await DerivableHelper.deploy(
        derivablePool.address,
        derivable1155.address,
        stateCalHelper.address
      )
      await derivableHelper.deployed()
      // setup accA
      await weth.connect(accountA).deposit({
        value: pe("1000000")
      })
      // setup accB
      await weth.connect(accountB).deposit({
        value: pe("1000000")
      })
      await usdc.transfer(accountB.address, pe("100000000"))
      return {
        owner,
        accountA,
        accountB,
        weth,
        usdc,
        utr,
        uniswapFactory,
        derivablePool,
        derivablePool1,
        createPoolTimestamp,
        derivable1155,
        uniswapRouter,
        derivableHelper,
        uniswapPositionManager,
        stateCalHelper
      }
    }

    describe("Future Expiration", function () {
      it("Check time lock of the tokens of pool owner", async function () {
        const { owner, weth, derivablePool1, derivable1155, stateCalHelper, accountB, createPoolTimestamp } = await loadFixture(deployDDLv2)
        await weth.approve(derivablePool1.address, MaxUint256)
        await expect(derivablePool1.swap(
          SIDE_R,
          SIDE_A,
          stateCalHelper.address,
          encodePayload(0, SIDE_R, SIDE_A, pe(1)),
          0,
          AddressZero,
          accountB.address,
          opts
        )).to.be.revertedWith('INSUFFICIENT_EXPIRATION_D')
        await expect(derivablePool1.swap(
          SIDE_A,
          SIDE_C,
          stateCalHelper.address,
          encodePayload(0, SIDE_A, SIDE_R, pe(1)),
          0,
          AddressZero,
          accountB.address,
          opts
        )).to.be.revertedWith('INSUFFICIENT_EXPIRATION_C')
        await time.setNextBlockTimestamp(createPoolTimestamp + 12 * 60 * 60 - 1)
        await expect(derivable1155.safeTransferFrom(
          owner.address,
          accountB.address,
          convertId(SIDE_C, derivablePool1.address),
          await derivable1155.balanceOf(owner.address, convertId(SIDE_C, derivablePool1.address)),
          0x0
        )).to.be.revertedWith('unexpired')
        await time.increase(1)
        await derivable1155.safeTransferFrom(
          owner.address,
          accountB.address,
          convertId(SIDE_C, derivablePool1.address),
          await derivable1155.balanceOf(owner.address, convertId(SIDE_C, derivablePool1.address)),
          0x0
        )
        await time.setNextBlockTimestamp(createPoolTimestamp + 24 * 60 * 60 - 1)
        await expect(derivable1155.safeTransferFrom(
          owner.address,
          accountB.address,
          convertId(SIDE_A, derivablePool1.address),
          await derivable1155.balanceOf(owner.address, convertId(SIDE_A, derivablePool1.address)),
          0x0
        )).to.be.revertedWith('unexpired')
        await time.increase(1)
        await derivable1155.safeTransferFrom(
          owner.address,
          accountB.address,
          convertId(SIDE_A, derivablePool1.address),
          await derivable1155.balanceOf(owner.address, convertId(SIDE_A, derivablePool1.address)),
          0x0
        )
      })

      if (DISCOUNT_RATE === 100) {
        it("R->A->R and R->A lock 1 year A->R", async function () {
          const { weth, derivablePool, stateCalHelper, derivable1155, accountA, accountB } = await loadFixture(deployDDLv2)
          const expiration = 365 * 24 * 60 * 60 // 5 days
          await weth.connect(accountA).approve(derivablePool.address, MaxUint256)
          await weth.connect(accountB).approve(derivablePool.address, MaxUint256)
          const wethAfterAccB = await weth.balanceOf(accountB.address)
          await derivablePool.connect(accountB).swap(
            SIDE_R,
            SIDE_A,
            stateCalHelper.address,
            encodePayload(0, SIDE_R, SIDE_A, pe(1)),
            0,
            AddressZero,
            accountB.address,
            opts
          )
          await derivablePool.connect(accountB).swap(
            SIDE_A,
            SIDE_R,
            stateCalHelper.address,
            encodePayload(0, SIDE_A, SIDE_R, await derivable1155.balanceOf(accountB.address, convertId(SIDE_A, derivablePool.address))),
            0,
            AddressZero,
            accountB.address,
            opts
          )
          const wethBeforeAccB = await weth.balanceOf(accountB.address)
          const wethChangedAccB = wethAfterAccB.sub(wethBeforeAccB)

          const wethAfterAccA = await weth.balanceOf(accountA.address)
          await derivablePool.connect(accountA).swap(
            SIDE_R,
            SIDE_A,
            stateCalHelper.address,
            encodePayload(0, SIDE_R, SIDE_A, pe(1)),
            expiration,
            AddressZero,
            accountA.address,
            opts
          )
          await time.increase(expiration * DISCOUNT_RATE / 100)
          await derivablePool.connect(accountA).swap(
            SIDE_A,
            SIDE_R,
            stateCalHelper.address,
            encodePayload(0, SIDE_A, SIDE_R, await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePool.address))),
            0,
            AddressZero,
            accountA.address,
            opts
          )
          const wethBeforeAccA = await weth.balanceOf(accountA.address)
          const wethChangedAccA = wethAfterAccA.sub(wethBeforeAccA)
          expect(Number(weiToNumber(wethChangedAccA)) / Number(weiToNumber(wethChangedAccB))).to.be.closeTo(1, 0.0000000001)
        })

        it("R->A lock 1 year A->R and R->A-R", async function () {
          const { weth, derivablePool, stateCalHelper, derivable1155, accountA, accountB } = await loadFixture(deployDDLv2)
          const expiration = 365 * 24 * 60 * 60 // 5 days
          await weth.connect(accountA).approve(derivablePool.address, MaxUint256)
          await weth.connect(accountB).approve(derivablePool.address, MaxUint256)

          const wethAfterAccA = await weth.balanceOf(accountA.address)
          await derivablePool.connect(accountA).swap(
            SIDE_R,
            SIDE_A,
            stateCalHelper.address,
            encodePayload(0, SIDE_R, SIDE_A, pe(1)),
            expiration,
            AddressZero,
            accountA.address,
            opts
          )
          await time.increase(expiration * DISCOUNT_RATE / 100)
          await derivablePool.connect(accountA).swap(
            SIDE_A,
            SIDE_R,
            stateCalHelper.address,
            encodePayload(0, SIDE_A, SIDE_R, await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePool.address))),
            0,
            AddressZero,
            accountA.address,
            opts
          )
          const wethBeforeAccA = await weth.balanceOf(accountA.address)
          const wethChangedAccA = wethAfterAccA.sub(wethBeforeAccA)
          const wethAfterAccB = await weth.balanceOf(accountB.address)
          await derivablePool.connect(accountB).swap(
            SIDE_R,
            SIDE_A,
            stateCalHelper.address,
            encodePayload(0, SIDE_R, SIDE_A, pe(1)),
            0,
            AddressZero,
            accountB.address,
            opts
          )
          await derivablePool.connect(accountB).swap(
            SIDE_A,
            SIDE_R,
            stateCalHelper.address,
            encodePayload(0, SIDE_A, SIDE_R, await derivable1155.balanceOf(accountB.address, convertId(SIDE_A, derivablePool.address))),
            0,
            AddressZero,
            accountB.address,
            opts
          )
          const wethBeforeAccB = await weth.balanceOf(accountB.address)
          const wethChangedAccB = wethAfterAccB.sub(wethBeforeAccB)
          expect(Number(weiToNumber(wethChangedAccA)) / Number(weiToNumber(wethChangedAccB))).to.be.closeTo(1, 0.0000000001)
        })
      } else {
        it("R->A lock 1 year\n" +
        "\tWait until ZeroInterestTime is up\n" +
        "\tR->A nolock\n" +
        "\tWait until the remaining time to reach 1 year\n" +
        "\tCompare", async function () {
          const { weth, derivablePool, stateCalHelper, derivable1155, accountA, accountB } = await loadFixture(deployDDLv2)
          const expiration = 365 * 24 * 60 * 60 // 5 days
          await weth.connect(accountA).approve(derivablePool.address, MaxUint256)
          await weth.connect(accountB).approve(derivablePool.address, MaxUint256)
          const wethAfterAccA = await weth.balanceOf(accountA.address)
          await derivablePool.connect(accountA).swap(
            SIDE_R,
            SIDE_A,
            stateCalHelper.address,
            encodePayload(0, SIDE_R, SIDE_A, pe(1)),
            expiration,
            AddressZero,
            accountA.address,
            opts
          )

          await time.increase(expiration * DISCOUNT_RATE / 100)
          const wethAfterAccB = await weth.balanceOf(accountB.address)
          await derivablePool.connect(accountB).swap(
            SIDE_R,
            SIDE_A,
            stateCalHelper.address,
            encodePayload(0, SIDE_R, SIDE_A, pe(1)),
            0,
            AddressZero,
            accountB.address,
            opts
          )

          await time.increase(expiration - expiration * DISCOUNT_RATE / 100)
          await derivablePool.connect(accountA).swap(
            SIDE_A,
            SIDE_R,
            stateCalHelper.address,
            encodePayload(0, SIDE_A, SIDE_R, await derivable1155.balanceOf(accountA.address, convertId(SIDE_A, derivablePool.address))),
            0,
            AddressZero,
            accountA.address,
            opts
          )
          await derivablePool.connect(accountB).swap(
            SIDE_A,
            SIDE_R,
            stateCalHelper.address,
            encodePayload(0, SIDE_A, SIDE_R, await derivable1155.balanceOf(accountB.address, convertId(SIDE_A, derivablePool.address))),
            0,
            AddressZero,
            accountB.address,
            opts
          )
          const wethBeforeAccA = await weth.balanceOf(accountA.address)
          const wethBeforeAccB = await weth.balanceOf(accountB.address)
          const wethChangedAccA = wethAfterAccA.sub(wethBeforeAccA)
          const wethChangedAccB = wethAfterAccB.sub(wethBeforeAccB)
          const tolerance = DISCOUNT_RATE < 10 ? 0.00001 : 0.0000000001
          expect(Number(weiToNumber(wethChangedAccA)) / Number(weiToNumber(wethChangedAccB))).to.be.closeTo(1, tolerance)
      })
      }
    })
  })
})

