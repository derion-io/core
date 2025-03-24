const {
  time,
} = require("@nomicfoundation/hardhat-network-helpers");
const { use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { _init, calculateInitParams } = require("./AsymptoticPerpetual");
const Pool = require("./Pool");
const { bn, numberToWei, encodeSqrtX96, packId } = require("./utilities");
const { ethers } = require("hardhat");
const { SIDE_A, SIDE_B, SIDE_C } = require("./constant");
const { AddressZero } = ethers.constants;

const AddressOne = "0x0000000000000000000000000000000000000001";

use(solidity)

function toConfig(params) {
  return {
    FETCHER: params.fetcher,
    ORACLE: params.oracle,
    TOKEN_R: params.reserveToken,
    MARK: params.mark,
    K: params.k,
    INTEREST_HL: params.halfLife,
    PREMIUM_HL: params.premiumHL,
    MATURITY: params.maturity,
    MATURITY_VEST: params.maturityVest,
    MATURITY_RATE: params.maturityRate,
    OPEN_RATE: params.openRate,
  }
}

/** 
 * @param options
 * @param options.feeRate
 * @param options.initReserved
 * @param options.callback
*/
function loadFixtureFromParams (arrParams, options={}) {
  async function fixture () {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;

    const LogicName = options.logicName || 'PoolLogic'
    // deploy utr
    const UTR = require("@derion/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy(signer.address)
    await utr.deployed()

    // deploy oracle library
    const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
    const oracleLibrary = await OracleLibrary.deploy()
    await oracleLibrary.deployed()

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      utr.address,
      owner.address,
      AddressZero
    )
    await derivable1155.deployed()

    // deploy fee receiver
    const FeeReceiver = await ethers.getContractFactory("FeeReceiver")
    const feeReceiver = await FeeReceiver.deploy(owner.address)
    await feeReceiver.deployed()

    // logic
    const feeRate = options.feeRate ?? 0
    const Logic = await ethers.getContractFactory(LogicName)
    const logic = await Logic.deploy(
      feeReceiver.address,
      feeRate,
    )
    await logic.deployed()

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy(
      logic.address
    )

    // deploy descriptor
    const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
    const tokenDescriptor = await TokenDescriptor.deploy(poolFactory.address)
    await tokenDescriptor.deployed()

    await derivable1155.setDescriptor(tokenDescriptor.address)

    // USDC
    const erc20Factory = await ethers.getContractFactory('USDC')
    const usdc = await erc20Factory.deploy(numberToWei('100000000000000000000'));

    // WETH
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
    const weth = await WETH.deploy();
    await weth.deposit({
      value: numberToWei("10000000000000000000")
    })
    await weth.connect(accountA).deposit({
      value: numberToWei("10000000000000000000")
    })
    await weth.connect(accountB).deposit({
      value: numberToWei("10000000000000000000")
    })
    
    // PoolDeployer
    const PoolDeployer = await ethers.getContractFactory("PoolDeployer");
    const poolDeployer = await PoolDeployer.deploy(weth.address, logic.address)

    // INIT PAIRRRRR 
    const initPrice = options.initPrice || 1500
    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const deno = options.initPriceDeno || 1
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? initPrice : deno, quoteTokenIndex ? deno : initPrice)
    const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
    const uniswapPair = await Univ3PoolMock.deploy(
      initPriceX96, 
      initPriceX96,
      quoteTokenIndex ? weth.address : usdc.address,
      quoteTokenIndex ? usdc.address : weth.address,
    )
    await uniswapPair.deployed()

    // deploy fetchPrice
    const FetchPrice = await ethers.getContractFactory("FetchPriceUniV3")
    const fetchPrice = await FetchPrice.deploy()
    await fetchPrice.deployed()

    // deploy helper
    const StateCalHelper = await ethers.getContractFactory("contracts/support/Helper.sol:Helper")
    const stateCalHelper = await StateCalHelper.deploy(
      derivable1155.address,
      weth.address
    )
    await stateCalHelper.deployed()

    // deploy ddl pool
    const oracle = ethers.utils.hexZeroPad(
      bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
      32,
    )
    const returnParams = []
    const pools = await Promise.all(arrParams.map(async params => {
      let realParams = {
        token: derivable1155.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        initTime: await time.latest(),
        ...params
      }
      realParams = await _init(oracleLibrary, numberToWei(options.initReserved || "5"), realParams)
      returnParams.push(realParams)

      const config = toConfig(realParams)
      const tx = await poolFactory.createPool(config)
      const receipt = await tx.wait()

      // const poolAddress = await poolFactory.computePoolAddress(realParams)
      const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
      // await weth.transfer(poolAddress, numberToWei(options.initReserved || "5"))

      await weth.approve(poolAddress, ethers.constants.MaxUint256)
      await weth.connect(accountA).approve(poolAddress, ethers.constants.MaxUint256)
      await weth.connect(accountB).approve(poolAddress, ethers.constants.MaxUint256)

      await derivable1155.setApprovalForAll(poolAddress, true)
      await derivable1155.connect(accountA).setApprovalForAll(poolAddress, true)
      await derivable1155.connect(accountB).setApprovalForAll(poolAddress, true)

      const pool = new Pool(
        await ethers.getContractAt(LogicName, poolAddress),
        realParams,
        {
          utr,
          helper: stateCalHelper
        }
      )

      pool.positioner = positionerForMaturity

      const initParams = options.calInitParams 
      ? await calculateInitParams(config, fetchPrice, numberToWei(options.initReserved ?? 5))
      : {
        R: numberToWei(options.initReserved ?? 5),
        a: realParams.a,
        b: realParams.b,
      }
      // const initParams = {
      //   R: numberToWei(options.initReserved ?? 5),
      //   a: realParams.a,
      //   b: realParams.b,
      // }
      const payment = {
        utr: AddressZero,
        payer: [],
        recipient: owner.address,
      }
      await pool.contract.init(initParams, payment)

      // permanently burn MINIMUM_SUPPLY of each token
      await derivable1155.safeBatchTransferFrom(
        owner.address,
        AddressOne,
        [
          packId(SIDE_A, pool.contract.address),
          packId(SIDE_B, pool.contract.address),
          packId(SIDE_C, pool.contract.address),
        ],
        [1000, 1000, 1000],
        '0x',
      )

      return pool
    }))

    let returns = {
      owner,
      accountA,
      accountB,
      weth,
      usdc,
      utr,
      poolFactory,
      poolDeployer,
      derivablePools: pools,
      derivable1155,
      feeReceiver,
      stateCalHelper,
      uniswapPair,
      oracleLibrary,
      params: returnParams,
      fetchPrice,
      feeRate,
    }

    if (options.callback) {
      returns = {
        ...returns,
        ...(await options.callback(returns))
      }
    }

    return returns
  }
  return fixture
}

module.exports = {
  loadFixtureFromParams
} 