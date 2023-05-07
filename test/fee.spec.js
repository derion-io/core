const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload, attemptSwap, attemptStaticSwap } = require("./shared/utilities");

use(solidity)

const opts = {
  gasLimit: 30000000
}

const FROM_ROUTER = 10;
const PAYMENT = 0;
const TRANSFER = 1;
const ALLOWANCE = 2;
const CALL_VALUE = 3;

const AMOUNT_EXACT = 0
const AMOUNT_ALL = 1
const EIP_ETH = 0
const ERC_721_BALANCE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ERC_721_BALANCE"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4


const HLs = [10 * 365 * 24 * 60 * 60]

const FEE_RATE = 12

HLs.forEach(HALF_LIFE => {
  describe(`Funding rate fee`, function () {
    async function deployDDLv2() {
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
        owner.address
      );

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
        mark: bn(1000).shl(128).div(38),
        k: 5,
        a: '30000000000',
        b: '30000000000',
        initTime: await time.latest(),
        halfLife: HALF_LIFE, // ten years
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

      async function swapAndWait(period, amount, side) {
        const balanceBefore = await weth.balanceOf(accountA.address)
        await attemptSwap(
          txSignerA,
          0,
          0x00,
          side,
          amount,
          stateCalHelper.address,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )

        const aTokenAmount = await derivable1155.balanceOf(accountA.address, packId(side, derivablePool.address))

        await time.increase(period)

        await attemptSwap(
          txSignerA,
          0,
          side,
          0x00,
          aTokenAmount,
          stateCalHelper.address,
          '0x0000000000000000000000000000000000000000',
          accountA.address
        )

        const balanceAfter = await weth.balanceOf(accountA.address)

        const totalFee = balanceBefore.sub(balanceAfter)

        const protocolFee = await derivablePool.callStatic.collect()
        const message = `${side == 0x10 ? 'LONG' : 'SHORT'} - ${weiToNumber(amount)}eth - ${period / HALF_LIFE}HL`
        expect(Number(weiToNumber(totalFee)) / Number(weiToNumber((protocolFee)))).to.be.closeTo(FEE_RATE + 1, 0.00001, message)
      }

      await poolFactory.setFeeTo(owner.address)

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
        swapAndWait,
        stateCalHelper
      }
    }

    describe("Long", function () {
      it("Wait 1 day", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(86400, numberToWei(0.1), 0x10)
      })

      it("Wait 0.5 HL", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(0.5 * HALF_LIFE, numberToWei(0.1), 0x10)
      })

      it("Wait 1 HL", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(HALF_LIFE, numberToWei(0.1), 0x10)
      })

      it("Wait 2 HL", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(2 * HALF_LIFE, numberToWei(0.1), 0x10)
      })

    })

    describe("Short", function () {
      it("Wait 1 day", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(86400, numberToWei(0.1), 0x20)
      })

      it("Wait 0.5 HL", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(0.5 * HALF_LIFE, numberToWei(0.1), 0x20)
      })

      it("Wait 1 HL", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(HALF_LIFE, numberToWei(0.1), 0x20)
      })

      it("Wait 2 HL", async function () {
        const { swapAndWait } = await loadFixture(deployDDLv2);
        await swapAndWait(2 * HALF_LIFE, numberToWei(0.1), 0x20)
      })

    })
  })
})


