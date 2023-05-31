const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { ethers } = require("hardhat")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt, encodePayload, weiToNumber } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
  gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

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

describe("DDL v3", function () {
  async function deployDDLv2() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;
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
    const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
    const usdc = await erc20Factory.deploy(numberToWei('100000000000000000000'));
    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);
    const uniswapFactory = await UniswapFactory.deploy()
    //WETH
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
    const weth = await WETH.deploy();
    // uniswap router
    const compiledUniswapRouter = require("./compiled/SwapRouter.json");
    const UniswapRouter = new ethers.ContractFactory(compiledUniswapRouter.abi, compiledUniswapRouter.bytecode, signer);
    // uniswap PM
    const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
    const Uniswapv3PositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer);
    // setup uniswap
    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
    const uniswapPositionManager = await Uniswapv3PositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')
    await uniswapFactory.createPool(usdc.address, weth.address, 500)
    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
    const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
    const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);
    await usdc.approve(uniswapRouter.address, MaxUint256);
    await weth.approve(uniswapRouter.address, MaxUint256);
    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    const a = await uniswapPair.initialize(initPriceX96)
    await uniswapPair.increaseObservationCardinalityNext(1000);
    a.wait(1);
    await time.increase(1000);
    // add liquidity
    await usdc.approve(uniswapPositionManager.address, MaxUint256);
    await weth.approve(uniswapPositionManager.address, MaxUint256);
    await uniswapPositionManager.mint({
      token0: quoteTokenIndex ? weth.address : usdc.address,
      token1: quoteTokenIndex ? usdc.address : weth.address,
      fee: 500,
      tickLower: Math.ceil(-887272 / 10) * 10,
      tickUpper: Math.floor(887272 / 10) * 10,
      amount0Desired: quoteTokenIndex ? pe('100') : pe('150000'),
      amount1Desired: quoteTokenIndex ? pe('150000') : pe('100'),
      amount0Min: 0,
      amount1Min: 0,
      recipient: owner.address,
      deadline: new Date().getTime() + 100000
    }, {
      value: pe('100'),
      gasLimit: 30000000
    })
    await time.increase(1000);
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
      halfLife: 0,
      premiumRate: 0,
      minExpirationD: 0,
      minExpirationC: 0,
      discountRate: 0
    }
    const poolAddress = await poolFactory.computePoolAddress(params)
    await weth.deposit({
      value: pe("10000000000000000000")
    })
    await weth.transfer(poolAddress, pe("10000"));
    await poolFactory.createPool(params);
    const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))
    // deploy helper
    const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
    const stateCalHelper = await StateCalHelper.deploy(
      derivable1155.address,
      weth.address
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
      value: pe("10000000000000000000")
    })
    await usdc.transfer(accountA.address, pe("10000000000000000000"))
    // setup accB
    await weth.connect(accountB).deposit({
      value: pe("10000000000000000000")
    })
    await usdc.transfer(accountB.address, pe("10000000000000000000"))

    const FlashloanAttack = await ethers.getContractFactory('FlashloanAttack');
    const flashloan = await FlashloanAttack.deploy(uniswapRouter.address, derivablePool.address)
    
    await flashloan.deployed()
    return {
      owner,
      accountA,
      accountB,
      weth,
      usdc,
      utr,
      uniswapFactory,
      derivablePool,
      derivable1155,
      uniswapRouter,
      derivableHelper,
      uniswapPositionManager,
      stateCalHelper,
      flashloan,
      uniswapPair
    }
  }

  function getSwapToSetPriceV3Params({ account, quoteToken, baseToken, initPrice, targetPrice }) {
    const quoteTokenIndex = baseToken.address.toLowerCase() < quoteToken.address.toLowerCase() ? 1 : 0
    const priceX96 = encodeSqrtX96(quoteTokenIndex ? targetPrice : 1, quoteTokenIndex ? 1 : targetPrice)
    return {
      tokenIn: (initPrice < targetPrice) ? quoteToken.address : baseToken.address,
      tokenOut: (initPrice < targetPrice) ? baseToken.address : quoteToken.address,
      fee: 500,
      sqrtPriceLimitX96: priceX96,
      recipient: account.address,
      deadline: new Date().getTime() + 100000,
      amountIn: pe("1000000000000000000"),
      amountOutMinimum: 0
    }
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

  describe("Pool", function () {
    describe("Flashloan", function () {
      it("Long", async function () {
        const { owner, weth, uniswapRouter, usdc, derivablePool, derivable1155, uniswapPair, flashloan, stateCalHelper } = await loadFixture(deployDDLv2)
        await weth.approve(derivablePool.address, MaxUint256)

        const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(SIDE_A, derivablePool.address))
        await derivablePool.swap(
          SIDE_R,
          SIDE_A,
          stateCalHelper.address,
          encodePayload(0, SIDE_R, SIDE_A, pe(1), derivable1155.address),
          0,
          AddressZero,
          owner.address,
          opts
        )
        const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(SIDE_A, derivablePool.address))
        const positionAmount = tokenAfter.sub(tokenBefore)
        
        const normalAmount = (await derivablePool.callStatic.swap(
          SIDE_A,
          SIDE_R,
          stateCalHelper.address,
          encodePayload(0, SIDE_A, SIDE_R, positionAmount, derivable1155.address),
          0,
          AddressZero,
          owner.address,
          opts
        )).amountOut

        const swapParams = getSwapToSetPriceV3Params({
          account: flashloan,
          baseToken: weth,
          quoteToken: usdc,
          uniswapRouter: uniswapRouter,
          initPrice: 1500,
          targetPrice: 15000
        })

        await usdc.transfer(flashloan.address, pe("1000000000000000000"))
        await derivable1155.safeTransferFrom(
          owner.address,
          flashloan.address,
          convertId(SIDE_A, derivablePool.address),
          positionAmount,
          0x0
        )

        const wethBefore = await weth.balanceOf(owner.address)
        await flashloan.attack(
          swapParams,
          derivable1155.address,
          SIDE_A,
          SIDE_R,
          stateCalHelper.address,
          encodePayload(0, SIDE_A, SIDE_R, positionAmount, derivable1155.address),
          0,
          AddressZero,
          owner.address,
        )
        const wethAfter = await weth.balanceOf(owner.address)
        
        expect(Number(weiToNumber(wethAfter.sub(wethBefore)))).to.be.closeTo(Number(weiToNumber(normalAmount)), 0.0001)
      })

      it("Short", async function () {
        const { owner, weth, uniswapRouter, usdc, derivablePool, derivable1155, flashloan, stateCalHelper } = await loadFixture(deployDDLv2)
        await weth.approve(derivablePool.address, MaxUint256)

        const tokenBefore = await derivable1155.balanceOf(owner.address, convertId(SIDE_B, derivablePool.address))
        await derivablePool.swap(
          SIDE_R,
          SIDE_B,
          stateCalHelper.address,
          encodePayload(0, SIDE_R, SIDE_B, pe(0.1), derivable1155.address),
          0,
          AddressZero,
          owner.address,
          opts
        )
        const tokenAfter = await derivable1155.balanceOf(owner.address, convertId(SIDE_B, derivablePool.address))
        const positionAmount = tokenAfter.sub(tokenBefore)
        
        const normalAmount = (await derivablePool.callStatic.swap(
          SIDE_B,
          SIDE_R,
          stateCalHelper.address,
          encodePayload(0, SIDE_B, SIDE_R, positionAmount, derivable1155.address),
          0,
          AddressZero,
          owner.address,
          opts
        )).amountOut

        const swapParams = getSwapToSetPriceV3Params({
          account: flashloan,
          baseToken: weth,
          quoteToken: usdc,
          uniswapRouter: uniswapRouter,
          initPrice: 1500,
          targetPrice: 150
        })

        await weth.transfer(flashloan.address, pe("1000000000000000000"))
        await derivable1155.safeTransferFrom(
          owner.address,
          flashloan.address,
          convertId(SIDE_B, derivablePool.address),
          positionAmount,
          0x0
        )

        const wethBefore = await weth.balanceOf(owner.address)
        await flashloan.attack(
          swapParams,
          derivable1155.address,
          SIDE_B,
          SIDE_R,
          stateCalHelper.address,
          encodePayload(0, SIDE_B, SIDE_R, positionAmount, derivable1155.address),
          0,
          AddressZero,
          owner.address,
        )
        const wethAfter = await weth.balanceOf(owner.address)
        expect(Number(weiToNumber(wethAfter.sub(wethBefore)))).to.be.closeTo(Number(weiToNumber(normalAmount)), 0.0001)
      })
    })
  })
})
