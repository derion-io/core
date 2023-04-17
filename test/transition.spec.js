const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload } = require("./shared/utilities");
const { scenerio01, scenerio02 } = require("./shared/scenerios");

use(solidity)

const scenerios = [
  {
    desc: "Mark 25",
    scenerio: scenerio01
  },
  {
    desc: "Mark 50",
    scenerio: scenerio02
  }
]

const opts = {
  gasLimit: 30000000
}

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

// const HALF_LIFE = 0

describe("Decay funding rate", function () {
  async function deployDDLv2() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;
    // deploy token1155

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy(
      // derivable1155.address
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
      mark: bn(50).shl(112).div(1000),
      k: 5,
      a: '30000000000',
      b: '30000000000',
      initTime: await time.latest(),
      halfLife: HALF_LIFE // ten years
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
    const stateCalHelper = await StateCalHelper.deploy()
    await stateCalHelper.deployed()

    const DerivableHelper = await ethers.getContractFactory("contracts/test/Helper.sol:Helper")
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
      encodePayload(0, 0x00, 0x30, numberToWei(0.5), derivable1155.address),
      '0x0000000000000000000000000000000000000000',
      accountA.address
    );

    return {
      C_ID,
      A_ID,
      B_ID,
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

  scenerios.forEach(scene => {
    describe(`Pool ${scene.desc}`, function () {
      async function amountInMustGteAmountInDesired(longAmount, rateLongSwapback, shortAmount, rateShortSwapback, period, prefix = '( )') {
        const { accountB, accountA, txSignerA, txSignerB, weth, derivable1155, A_ID, B_ID, stateCalHelper } = await loadFixture(scene.scenerio);
        await txSignerA.swap(
          0x00,
          0x30,
          stateCalHelper.address,
          encodePayload(0, 0x00, 0x30, numberToWei(1), derivable1155.address),
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        const wethABegin = await weth.balanceOf(accountA.address)
        const wethBBegin = await weth.balanceOf(accountB.address)
        await txSignerA.swap(
          0x00,
          0x10,
          stateCalHelper.address,
          encodePayload(0, 0x00, 0x10, longAmount, derivable1155.address),
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        await txSignerB.swap(
          0x00,
          0x20,
          stateCalHelper.address,
          encodePayload(0, 0x00, 0x20, shortAmount, derivable1155.address),
          '0x0000000000000000000000000000000000000000',
          accountB.address
        );
        const wethAAfter = await weth.balanceOf(accountA.address)
        const wethBAfter = await weth.balanceOf(accountB.address)
        if (period > 0) {
          await time.increase(period)
        }
        expect(wethABegin.sub(wethAAfter)).to.be.lte(longAmount, `${prefix}: Long R->A In > Desired`)
        expect(wethBBegin.sub(wethBAfter)).to.be.lte(shortAmount, `${prefix}: Long R->B In > Desired`)

        const tokenAAmountBefore = await derivable1155.balanceOf(accountA.address, A_ID)
        const tokenBAmountBefore = await derivable1155.balanceOf(accountB.address, B_ID)

        const amountAIn = tokenAAmountBefore.mul(rateLongSwapback).div(100)
        const amountBIn = tokenBAmountBefore.mul(rateShortSwapback).div(100)
        await txSignerA.swap(
          0x10,
          0x00,
          stateCalHelper.address,
          encodePayload(0, 0x10, 0x00, amountAIn, derivable1155.address),
          '0x0000000000000000000000000000000000000000',
          accountA.address
        );
        await txSignerB.swap(
          0x20,
          0x00,
          stateCalHelper.address,
          encodePayload(0, 0x20, 0x00, amountBIn, derivable1155.address),
          '0x0000000000000000000000000000000000000000',
          accountB.address
        );
        const tokenAAmountAfter = await derivable1155.balanceOf(accountA.address, A_ID)
        const tokenBAmountAfter = await derivable1155.balanceOf(accountB.address, B_ID)
        expect(tokenAAmountBefore.sub(tokenAAmountAfter), `${prefix}: amountInA`).lte(amountAIn)
        expect(tokenBAmountBefore.sub(tokenBAmountAfter), `${prefix}: amountInB`).lte(amountBIn)
      }
      describe(`${scene.desc} ` + "In > Desired", function () {
        it("1e Long - 100% back, 1e Short - 100% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            100,
            numberToWei(1),
            100,
            "1e Long - 50% back, 1e Short - 50% back"
          )
        })
        it("1e Long - 50% back, 0.5e Short - 50% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            50,
            numberToWei(0.5),
            50,
            "1e Long - 50% back, 0.5e Short - 50% back"
          )
        })
        it("1e Long - 30% back, 1e Short - 40% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            30,
            numberToWei(1),
            40,
            "1e Long - 30% back, 1e Short - 40% back"
          )
        })
        it("0.7e Long - 33% back, 0.9e Short - 49% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(0.7),
            33,
            numberToWei(0.9),
            49,
            "0.7e Long - 33% back, 0.9e Short - 49% back"
          )
        })
        it("1e Long - 90% back, 0.1e Short - 100% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            90,
            numberToWei(0.1),
            100,
            "1e Long - 90% back, 0.1e Short - 100% back"
          )
        })
        it("0.1e Long - 70% back, 1e Short - 30% back", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(0.1),
            70,
            numberToWei(1),
            30,
            "0.1e Long - 70% back, 1e Short - 30% back"
          )
        })
        it("0.7e Long - 33% back, 0.9e Short - 49% back, wait HL", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(0.7),
            33,
            numberToWei(0.9),
            49,
            HALF_LIFE,
            "0.7e Long - 33% back, 0.9e Short - 49% back"
          )
        })
        it("1e Long - 90% back, 0.1e Short - 100% back, wait 0.5 HL", async function () {
          await amountInMustGteAmountInDesired(
            numberToWei(1),
            90,
            numberToWei(0.1),
            100,
            0.5 * HALF_LIFE,
            "1e Long - 90% back, 0.1e Short - 100% back"
          )
        })
      })
    });
  });
})