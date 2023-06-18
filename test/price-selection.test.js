const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { _init } = require("./shared/AsymptoticPerpetual")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt, encodePayload, weiToNumber, attemptSwap, feeToOpenRate } = require("./shared/utilities")

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

const HALF_LIFE = 0

describe("Price selection", function () {
  async function fixture() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;

    // deploy oracle library
    const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
    const oracleLibrary = await OracleLibrary.deploy()
    await oracleLibrary.deployed()

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory")
    const poolFactory = await PoolFactory.deploy(
      owner.address
    )

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

    //WETH
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
    const weth = await WETH.deploy();

    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    
    // INIT PAIRRRRR 
    const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
    const uniswapPair = await Univ3PoolMock.deploy(
      initPriceX96, 
      initPriceX96,
      quoteTokenIndex ? weth.address : usdc.address,
      quoteTokenIndex ? usdc.address : weth.address,
    )
    await uniswapPair.deployed()

    await weth.deposit({
      value: pe("10000000000000000000")
    })

    // deploy ddl pool
    const oracle = ethers.utils.hexZeroPad(
      bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
      32,
    )
    let params = {
      utr: utr.address,
      token: derivable1155.address,
      oracle,
      reserveToken: weth.address,
      recipient: owner.address,
      mark: bn(38).shl(128),
      k: bn(5),
      a: pe(1),
      b: pe(1),
      initTime: 0,
      halfLife: bn(HALF_LIFE),
      premiumRate: bn(1).shl(128).div(2),
      maturity: 0,
      maturityCoefficient: 0,
      discountRate: 0,
      feeHalfLife: 0,
      openRate: feeToOpenRate(0)
    }
    params = await _init(oracleLibrary, pe("5"), params)
    const poolAddress = await poolFactory.computePoolAddress(params)
    await weth.transfer(poolAddress, pe("5"));
    await poolFactory.createPool(params);
    const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", await poolFactory.computePoolAddress(params))

    // deploy helper
    const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
    const stateCalHelper = await StateCalHelper.deploy(
      derivable1155.address,
      weth.address
    )
    await stateCalHelper.deployed()

    await weth.approve(derivablePool.address, MaxUint256)

    await derivable1155.setApprovalForAll(derivablePool.address, true)

    return {
      owner,
      accountA,
      accountB,
      weth,
      usdc,
      utr,
      derivablePool,
      derivable1155,
      stateCalHelper,
      uniswapPair
    }
  }

  async function swapToSetPriceV3({ quoteToken, baseToken, uniswapPair, targetTwap, targetSpot }) {
    const quoteTokenIndex = baseToken.address.toLowerCase() < quoteToken.address.toLowerCase() ? 1 : 0
    const priceTwapX96 = encodeSqrtX96(quoteTokenIndex ? targetTwap : 1, quoteTokenIndex ? 1 : targetTwap)
    const priceSpotX96 = encodeSqrtX96(quoteTokenIndex ? targetSpot : 1, quoteTokenIndex ? 1 : targetSpot)
    await uniswapPair.setPrice(priceSpotX96, priceTwapX96)
  }

  async function testPriceSelection(targetPrice, sideIn, sideOut) {
    const {
      owner,
      usdc,
      weth,
      derivablePool,
      stateCalHelper,
      uniswapPair
    } = await loadFixture(fixture)

    // twap = spot = 1500
    const firstOut = (await derivablePool.callStatic.swap(
      sideIn,
      sideOut,
      stateCalHelper.address,
      encodePayload(0, sideIn, sideOut, pe(0.1)),
      0,
      AddressZero,
      owner.address
    )).amountOut

    // twap = spot = targetPrice
    await swapToSetPriceV3({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: targetPrice,
      targetSpot: targetPrice
    })
    const secondOut = (await derivablePool.callStatic.swap(
      sideIn,
      sideOut,
      stateCalHelper.address,
      encodePayload(0, sideIn, sideOut, pe(0.1)),
      0,
      AddressZero,
      owner.address
    )).amountOut

    // twap = targetPrice, spot = 1500
    await swapToSetPriceV3({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: targetPrice,
      targetSpot: 1500
    })
    const thirdOut = (await derivablePool.callStatic.swap(
      sideIn,
      sideOut,
      stateCalHelper.address,
      encodePayload(0, sideIn, sideOut, pe(0.1)),
      0,
      AddressZero,
      owner.address
    )).amountOut

    // twap = 1500, spot = targetPrice
    await swapToSetPriceV3({
      quoteToken: usdc,
      baseToken: weth,
      uniswapPair,
      targetTwap: 1500,
      targetSpot: targetPrice
    })
    const fourthOut = (await derivablePool.callStatic.swap(
      sideIn,
      sideOut,
      stateCalHelper.address,
      encodePayload(0, sideIn, sideOut, pe(0.1)),
      0,
      AddressZero,
      owner.address
    )).amountOut
    
    const min = firstOut.lte(secondOut) ? firstOut : secondOut
    expect(min).to.be.equal(thirdOut)
    expect(min).to.be.equal(fourthOut)
  }

  it("Price up; R->A", async function () {
    await testPriceSelection(1700, SIDE_R, SIDE_A)
  })

  it("Price up; R->B", async function () {
    await testPriceSelection(1700, SIDE_R, SIDE_B)
  })

  it("Price up; R->C", async function () {
    await testPriceSelection(1700, SIDE_R, SIDE_C)
  })

  it("Price up; A->R", async function () {
    await testPriceSelection(1700, SIDE_A, SIDE_R)
  })

  it("Price up; B->R", async function () {
    await testPriceSelection(1700, SIDE_B, SIDE_R)
  })

  it("Price up; C->R", async function () {
    await testPriceSelection(1700, SIDE_C, SIDE_R)
  })

  it("Price down; R->A", async function () {
    await testPriceSelection(1300, SIDE_R, SIDE_A)
  })

  it("Price down; R->B", async function () {
    await testPriceSelection(1300, SIDE_R, SIDE_B)
  })

  it("Price down; R->C", async function () {
    await testPriceSelection(1300, SIDE_R, SIDE_C)
  })

  it("Price down; A->R", async function () {
    await testPriceSelection(1300, SIDE_A, SIDE_R)
  })

  it("Price down; B->R", async function () {
    await testPriceSelection(1300, SIDE_B, SIDE_R)
  })

  it("Price down; C->R", async function () {
    await testPriceSelection(1300, SIDE_C, SIDE_R)
  })
})