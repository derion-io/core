const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload } = require("./utilities");

use(solidity)

const opts = {
  gasLimit: 30000000
}

const TRANSFER_FROM_SENDER = 0
const TRANSFER_FROM_ROUTER = 1
const TRANSFER_CALL_VALUE = 2
const IN_TX_PAYMENT = 4
const ALLOWANCE_BRIDGE = 8
const AMOUNT_EXACT = 0
const AMOUNT_ALL = 1
const EIP_ETH = 0
const ERC_721_BALANCE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ERC_721_BALANCE"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

// const HALF_LIFE = 0


async function scenerio01() {
  const [owner, accountA, accountB] = await ethers.getSigners();
  const signer = owner;
  // deploy token1155

  const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
  const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
  const utr = await UniversalRouter.deploy()
  await utr.deployed()

  // deploy pool factory
  const PoolFactory = await ethers.getContractFactory("PoolFactory");
  const poolFactory = await PoolFactory.deploy(
    owner.address,
    // derivable1155.address
  );
  // weth test
  const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
  const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
  // uniswap factory
  const compiledUniswapFactory = require("../compiled/UniswapV3Factory.json");
  const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);
  // uniswap router

  const compiledUniswapv3Router = require("../compiled/SwapRouter.json");
  const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer);
  // uniswap PM

  const compiledUniswapv3PositionManager = require("../compiled/NonfungiblePositionManager.json");
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

  const compiledUniswapPool = require("../compiled/UniswapV3Pool.json");
  const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
  const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);

  await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256);
  await weth.approve(uniswapRouter.address, ethers.constants.MaxUint256);

  const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
  const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
  const a = await uniswapPair.initialize(initPriceX96)
  a.wait(1);

  await time.increase(1000);

  const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual");

  const asymptoticPerpetual = await AsymptoticPerpetual.deploy();
  await asymptoticPerpetual.deployed();

  // deploy token1155
  const Token = await ethers.getContractFactory("Token")
  const derivable1155 = await Token.deploy(
    "Test/",
    utr.address
  )
  await derivable1155.deployed()

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
    mark: bn(40).shl(128),
    k: 5,
    a: '30000000000',
    b: '30000000000',
    initTime: await time.latest(),
    halfLife: HALF_LIFE,
    minExpirationD: 0,
    minExpirationC: 0,
  }
  const poolAddress = await poolFactory.computePoolAddress(params);
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
  await weth.transfer(poolAddress, numberToWei(1));
  await poolFactory.createPool(params);
  const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params));

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
  const A_ID = packId(0x10, derivablePool.address);
  const B_ID = packId(0x20, derivablePool.address);
  const R_ID = packId(0x00, derivablePool.address);
  const C_ID = packId(0x30, derivablePool.address);
  await weth.approve(derivablePool.address, '100000000000000000000000000');

  txSignerA = weth.connect(accountA);
  txSignerB = weth.connect(accountB);
  await txSignerA.approve(derivablePool.address, '100000000000000000000000000');
  await txSignerB.approve(derivablePool.address, '100000000000000000000000000');
  txSignerA = derivable1155.connect(accountA);
  await txSignerA.setApprovalForAll(derivablePool.address, true);
  txSignerB = derivable1155.connect(accountB);
  await txSignerB.setApprovalForAll(derivablePool.address, true);
  txSignerA = derivablePool.connect(accountA);
  txSignerB = derivablePool.connect(accountB);

  await txSignerA.swap(
    0x00,
    0x30,
    stateCalHelper.address,
    encodePayload(0, 0x00, 0x30, numberToWei(0.5)),
    0,
    '0x0000000000000000000000000000000000000000',
    accountA.address
  );

  return {
    C_ID,
    A_ID,
    B_ID,
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
    stateCalHelper
  }
}

async function scenerio02() {
  const [owner, accountA, accountB] = await ethers.getSigners();
  const signer = owner;
  // deploy token1155

  const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
  const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
  const utr = await UniversalRouter.deploy()
  await utr.deployed()

  // deploy pool factory
  const PoolFactory = await ethers.getContractFactory("PoolFactory");
  const poolFactory = await PoolFactory.deploy(
    owner.address,
    // derivable1155.address
  );
  // weth test
  const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
  const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
  // uniswap factory
  const compiledUniswapFactory = require("../compiled/UniswapV3Factory.json");
  const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);
  // uniswap router

  const compiledUniswapv3Router = require("../compiled/SwapRouter.json");
  const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer);
  // uniswap PM

  const compiledUniswapv3PositionManager = require("../compiled/NonfungiblePositionManager.json");
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

  const compiledUniswapPool = require("../compiled/UniswapV3Pool.json");
  const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
  const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);

  await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256);
  await weth.approve(uniswapRouter.address, ethers.constants.MaxUint256);

  const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
  const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
  const a = await uniswapPair.initialize(initPriceX96)
  a.wait(1);

  await time.increase(1000);

  const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual");

  const asymptoticPerpetual = await AsymptoticPerpetual.deploy();
  await asymptoticPerpetual.deployed();

  // deploy token1155
  const Token = await ethers.getContractFactory("Token")
  const derivable1155 = await Token.deploy(
    "Test/",
    utr.address
  )
  await derivable1155.deployed()

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
    mark: bn(20).shl(128),
    k: 5,
    a: '30000000000',
    b: '30000000000',
    initTime: await time.latest(),
    halfLife: HALF_LIFE,
    minExpirationD: 0,
    minExpirationC: 0,
  }
  const poolAddress = await poolFactory.computePoolAddress(params);
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
  await weth.transfer(poolAddress, numberToWei(1));
  await poolFactory.createPool(params);
  const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params));

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
  const A_ID = packId(0x10, derivablePool.address);
  const B_ID = packId(0x20, derivablePool.address);
  const R_ID = packId(0x00, derivablePool.address);
  const C_ID = packId(0x30, derivablePool.address);
  await weth.approve(derivablePool.address, '100000000000000000000000000');

  txSignerA = weth.connect(accountA);
  txSignerB = weth.connect(accountB);
  await txSignerA.approve(derivablePool.address, '100000000000000000000000000');
  await txSignerB.approve(derivablePool.address, '100000000000000000000000000');
  txSignerA = derivable1155.connect(accountA);
  await txSignerA.setApprovalForAll(derivablePool.address, true);
  txSignerB = derivable1155.connect(accountB);
  await txSignerB.setApprovalForAll(derivablePool.address, true);
  txSignerA = derivablePool.connect(accountA);
  txSignerB = derivablePool.connect(accountB);

  await txSignerA.swap(
    0x00,
    0x30,
    stateCalHelper.address,
    encodePayload(0, 0x00, 0x30, numberToWei(0.5)),
    0,
    '0x0000000000000000000000000000000000000000',
    accountA.address
  );

  return {
    C_ID,
    A_ID,
    B_ID,
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
    stateCalHelper
  }
}

module.exports = {
  scenerio01,
  scenerio02
} 