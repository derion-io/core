const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload, attemptSwap, attemptStaticSwap } = require("./shared/utilities");
const abiCoder = new ethers.utils.AbiCoder()
use(solidity)

const SECONDS_PER_DAY = 86400
const MIN_EXPIRE = SECONDS_PER_DAY;
const DC = 50

function toHalfLife(dailyRate) {
  return dailyRate == 0 ? 0 : Math.round(SECONDS_PER_DAY / Math.log2(1 / (1 - dailyRate)))
}

describe("Premium and Future", function () {
  async function fixture() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;
    // deploy logic container
    const LogicContainer = await ethers.getContractFactory("LogicContainer")
    const logicContainer = await LogicContainer.deploy()
    await logicContainer.deployed()

    // deploy UTR
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy(
      owner.address,
      logicContainer.address,
      12,
      toHalfLife(0.06) * 12
    );
    await poolFactory.setFeeTo(owner.address)

    // weth test
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);

    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);

    // uniswap router
    const compiledUniswapv3Router = require("./compiled/SwapRouter.json");
    const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer);

    // uniswap PM
    const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
    const UniswapPositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer);

    // erc20 factory
    const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);

    // setup uniswap
    const usdc = await erc20Factory.deploy(numberToWei(100000000000));
    const weth = await WETH.deploy();
    const uniswapFactory = await UniswapFactory.deploy();
    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
    const uniswapPositionManager = await UniswapPositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')

    await uniswapFactory.createPool(usdc.address, weth.address, 500)

    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
    const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
    const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);

    await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256);
    await weth.approve(uniswapRouter.address, ethers.constants.MaxUint256);

    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    const a = await uniswapPair.initialize(initPriceX96)
    a.wait(1);

    await time.increase(1000);

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      utr.address,
      owner.address,
      owner.address
    )
    await derivable1155.deployed()

    // weth deposit
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

    // deploy ddl pool no premium
    const oracle = ethers.utils.hexZeroPad(
      bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
      32,
    )
    const params = {
      utr: utr.address,
      token: derivable1155.address,
      oracle,
      reserveToken: weth.address,
      recipient: owner.address,
      mark: bn(1000).shl(128).div(38),
      k: 5,
      a: '30000000000',
      b: '30000000000',
      initTime: 0,
      halfLife: toHalfLife(0.006), // ten years
      premiumRate: '0',
      minExpirationD: MIN_EXPIRE,
      minExpirationC: MIN_EXPIRE,
      discountRate: bn(DC).shl(128).div(100),
      feeHalfLife: 0
    }
    const poolNoPremiumAddress = await poolFactory.computePoolAddress(params);
    await weth.transfer(poolNoPremiumAddress, numberToWei(1));
    await poolFactory.createPool(params);
    const derivablePoolNoPremium = await ethers.getContractAt("AsymptoticPerpetual", poolNoPremiumAddress);

    // deploy ddl pool premium
    params.premiumRate = bn(1).shl(128).div(2)
    const config = {
      TOKEN: derivable1155.address,
      TOKEN_R: weth.address,
      ORACLE: oracle,
      K: 5,
      MARK: bn(1000).shl(128).div(38),
      INIT_TIME: params.initTime,
      HALF_LIFE: params.halfLife,
      PREMIUM_RATE: params.premiumRate
    }
    const poolAddress = await poolFactory.computePoolAddress(params);
    await weth.transfer(poolAddress, numberToWei(1));
    await poolFactory.createPool(params);
    const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", poolAddress);
    await time.increase(100);

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

    const C_ID = packId(0x30, derivablePool.address);
    await weth.approve(derivablePool.address, '100000000000000000000000000');

    txSignerA = weth.connect(accountA);
    txSignerB = weth.connect(accountB);
    await txSignerA.approve(derivablePool.address, '100000000000000000000000000');
    await txSignerB.approve(derivablePool.address, '100000000000000000000000000');
    await txSignerA.approve(derivablePoolNoPremium.address, '100000000000000000000000000');
    await txSignerB.approve(derivablePoolNoPremium.address, '100000000000000000000000000');

    txSignerA = derivable1155.connect(accountA);
    txSignerB = derivable1155.connect(accountB);
    await txSignerB.setApprovalForAll(derivablePool.address, true);
    await txSignerA.setApprovalForAll(derivablePool.address, true);
    await txSignerB.setApprovalForAll(derivablePoolNoPremium.address, true);
    await txSignerA.setApprovalForAll(derivablePoolNoPremium.address, true);

    txSignerA = derivablePool.connect(accountA);
    txSignerB = derivablePool.connect(accountB);
    const txSignerANoPremium = derivablePoolNoPremium.connect(accountA);
    const txSignerBNoPremium = derivablePoolNoPremium.connect(accountB);

    return {
      C_ID,
      utr,
      owner,
      weth,
      derivablePool,
      derivable1155,
      derivableHelper,
      accountA,
      accountB,
      txSignerA,
      txSignerB,
      txSignerANoPremium,
      txSignerBNoPremium,
      stateCalHelper,
      config,
      params
    }
  }

  it("Premium with future Long", async function () {
    const { txSignerA, stateCalHelper, accountA } = await loadFixture(fixture)

    const payload = abiCoder.encode(
      ["uint", "uint", "uint", "uint"],
      [0, 0x00, 0x10, numberToWei(1)]
    )
    await txSignerA.swap(
      0x00,
      0x10,
      stateCalHelper.address,
      payload,
      365 * SECONDS_PER_DAY,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    )
  })

  it("Premium with future Short", async function () {
    const { txSignerA, stateCalHelper, accountA } = await loadFixture(fixture)

    const payload = abiCoder.encode(
      ["uint", "uint", "uint", "uint"],
      [0, 0x00, 0x20, numberToWei(1)]
    )
    await txSignerA.swap(
      0x00,
      0x20,
      stateCalHelper.address,
      payload,
      365 * SECONDS_PER_DAY,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    )
  })

})
