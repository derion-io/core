const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96 } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
  gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const AMOUNT_EXACT = 0;
const IN_TX_PAYMENT = 4;
const TRANSFER_FROM_SENDER = 0;

describe("DDL v3", function () {
  async function deployDDLv2() {
    const [owner, otherAccount] = await ethers.getSigners()
    const signer = owner
    // deploy utr
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory")
    const poolFactory = await PoolFactory.deploy()
    // weth test
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer)
    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json")
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer)
    // uniswap router
    const compiledUniswapv3Router = require("./compiled/SwapRouter.json")
    const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer)
    // uniswap PM
    const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json")
    const UniswapPositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer)
    // erc20 factory
    const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json")
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer)
    // setup uniswap
    const usdc = await erc20Factory.deploy(numberToWei(100000000000))
    const weth = await WETH.deploy()
    const uniswapFactory = await UniswapFactory.deploy()
    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address)
    const uniswapPositionManager = await UniswapPositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')

    await uniswapFactory.createPool(usdc.address, weth.address, 500)

    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json")
    const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
    const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer)

    await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256)
    await weth.approve(uniswapRouter.address, ethers.constants.MaxUint256)

    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    const a = await uniswapPair.initialize(initPriceX96)
    a.wait(1)

    await time.increase(1000)

    const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")

    const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
    await asymptoticPerpetual.deployed()

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      "Test/",
      utr.address
    )
    await derivable1155.deployed()

    // deploy ddl pool
    const oracle = bn(1).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString()
    const params = {
      utr: utr.address,
      token: derivable1155.address,
      logic: asymptoticPerpetual.address,
      oracle,
      reserveToken: weth.address,
      recipient: owner.address,
      mark: bn(1000).shl(112),
      k: 5,
      a: numberToWei(1),
      b: numberToWei(1)
    }
    const poolAddress = await poolFactory.computePoolAddress(params)
    await weth.deposit({
      value: pe("100000000")
    })
    await weth.transfer(poolAddress, pe("10"))
    await poolFactory.createPool(params)
    const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))

    const R_ID = packId(SIDE_R, derivablePool.address)
    const LONG_ID = packId(SIDE_A, derivablePool.address)
    const SHORT_ID = packId(SIDE_B, derivablePool.address)
    const LP_ID = packId(SIDE_C, derivablePool.address)

    return {
      owner,
      weth,
      utr,
      derivablePool,
      derivable1155,
      R_ID,
      LONG_ID,
      SHORT_ID,
      LP_ID
    }
  }

  describe("Pool", function () {
    async function testRIn(sideIn, amountIn, sideOut, isUseUTR) {
      const { owner, weth, derivablePool, derivable1155, R_ID, LONG_ID, SHORT_ID, LP_ID, utr } = await loadFixture(deployDDLv2)
      let convertedId
      switch (sideOut) {
        case SIDE_R:
          convertedId = R_ID
          break;
        case SIDE_A:
          convertedId = LONG_ID
          break;
        case SIDE_B:
          convertedId = SHORT_ID
          break;
        case SIDE_C:
          convertedId = LP_ID
          break;
        default:
          break;
      }

      await weth.approve(derivablePool.address, MaxUint256)
      const amountOutOfExactIn = await derivablePool.callStatic.exactIn(
        sideIn,
        pe(amountIn),
        sideOut,
        AddressZero,
        owner.address,
        opts
      )

      const payer = isUseUTR ? owner.address : AddressZero
      if (isUseUTR) {
        await weth.approve(utr.address, MaxUint256)
        await utr.exec([{
          eip: 1155,
          token: derivable1155.address,
          id: convertedId,
          amountOutMin: amountOutOfExactIn,
          recipient: owner.address,
        }], [{
          inputs: [{
            mode: IN_TX_PAYMENT,
            eip: 20,
            token: weth.address,
            id: 0,
            amountSource: AMOUNT_EXACT,
            amountInMax: pe(amountIn),
            recipient: derivablePool.address,
          }],
          flags: 0,
          code: derivablePool.address,
          data: (await derivablePool.populateTransaction.exactIn(
            sideIn,
            pe(amountIn),
            sideOut,
            payer,
            owner.address
          )).data,
        }], opts)
      }
      else {
        await weth.approve(derivablePool.address, MaxUint256)
        await time.increase(100)
        const oldAmount = await derivable1155.balanceOf(owner.address, convertedId)
        await expect(() => derivablePool.exactIn(
          sideIn,
          pe(amountIn),
          sideOut,
          payer,
          owner.address,
          opts
        )).to.changeTokenBalances(weth, [owner, derivablePool], [pe("-" + amountIn), pe(amountIn)])
        const newAmount = await derivable1155.balanceOf(owner.address, convertedId)
        const amountChanged = Number(fe(newAmount.sub(oldAmount)))
        expect(amountChanged).to.equal(Number(fe(amountOutOfExactIn)))
      }
    }
    it("weth -> lp: Non UTR", async function () {
      await testRIn(SIDE_R, "1", SIDE_C, false)
    })
    it("weth -> long: Non UTR", async function () {
      await testRIn(SIDE_R, "0.5", SIDE_A, false)
    })
    it("weth -> short: Non UTR", async function () {
      await testRIn(SIDE_R, "0.5", SIDE_B, false)
    })

    it("weth -> lp: UTR", async function () {
      await testRIn(SIDE_R, "1", SIDE_C, true)
    })
    it("weth -> long: UTR", async function () {
      await testRIn(SIDE_R, "0.5", SIDE_A, true)
    })
    it("weth -> short: UTR", async function () {
      await testRIn(SIDE_R, "0.5", SIDE_B, true)
    })

    async function testROut(sideIn, amountIn, sideOut, isUseUTR) {
      const { owner, weth, derivablePool, derivable1155, R_ID, LONG_ID, SHORT_ID, LP_ID, utr } = await loadFixture(deployDDLv2)
      let convertedId
      switch (sideIn) {
        case SIDE_R:
          convertedId = R_ID
          break;
        case SIDE_A:
          convertedId = LONG_ID
          break;
        case SIDE_B:
          convertedId = SHORT_ID
          break;
        case SIDE_C:
          convertedId = LP_ID
          break;
        default:
          break;
      }

      const payer = isUseUTR ? owner.address : AddressZero
      await weth.approve(derivablePool.address, MaxUint256)
      const amountOutOfExactIn = await derivablePool.callStatic.exactIn(
        sideIn,
        pe(amountIn),
        sideOut,
        AddressZero,
        owner.address,
        opts
      )
      await time.increase(100)
      if (isUseUTR) {
        await weth.approve(utr.address, MaxUint256)
        await utr.exec([{
          eip: 20,
          token: weth.address,
          id: 0,
          amountOutMin: amountOutOfExactIn,
          recipient: owner.address,
        }], [{
          inputs: [{
            mode: IN_TX_PAYMENT,
            eip: 1155,
            token: derivable1155.address,
            id: convertedId,
            amountSource: AMOUNT_EXACT,
            amountInMax: pe(amountIn),
            recipient: derivablePool.address,
          }],
          flags: 0,
          code: derivablePool.address,
          data: (await derivablePool.populateTransaction.exactIn(
            sideIn,
            pe(amountIn),
            sideOut,
            payer,
            owner.address
          )).data,
        }], opts)
      } else {
        await expect(() => derivablePool.exactIn(
          sideIn,
          pe(amountIn),
          sideOut,
          AddressZero,
          owner.address,
          opts
        )).to.changeTokenBalances(weth, [derivablePool, owner], ["-" + amountOutOfExactIn, amountOutOfExactIn])
      }
    }
    it("lp -> weth: Non UTR", async function () {
      await testROut(SIDE_C, "1", SIDE_R, false)
    })
    it("long -> weth: Non UTR", async function () {
      await testROut(SIDE_A, "0.1", SIDE_R, false)
    })
    it("short -> weth: Non UTR", async function () {
      await testROut(SIDE_B, "0.1", SIDE_R, false)
    })

    it("lp -> weth: UTR", async function () {
      await testROut(SIDE_C, "1", SIDE_R, true)
    })
    it("long -> weth: UTR", async function () {
      await testROut(SIDE_A, "0.1", SIDE_R, true)
    })
    it("short -> weth: UTR", async function () {
      await testROut(SIDE_B, "0.1", SIDE_R, true)
    })
  })
})