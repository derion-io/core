const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload, attemptSwap, attemptStaticSwap } = require("./shared/utilities");
const abiCoder = new ethers.utils.AbiCoder()
use(solidity)

const HALF_LIFE = 0;

describe("Premium", function () {
  async function fixture() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;

    // deploy UTR
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy(
      owner.address,
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

    const AsymptoticPerpetual = await ethers.getContractFactory("$AsymptoticPerpetual");

    const asymptoticPerpetual = await AsymptoticPerpetual.deploy();
    await asymptoticPerpetual.deployed();

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      "Test/",
      utr.address
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
      premiumRate: '0',
      minExpirationD: 0,
      minExpirationC: 0,
    }
    const poolNoPremiumAddress = await poolFactory.computePoolAddress(params);
    await weth.transfer(poolNoPremiumAddress, numberToWei(1));
    await poolFactory.createPool(params);
    const derivablePoolNoPremium = await ethers.getContractAt("Pool", poolNoPremiumAddress);

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
    const derivablePool = await ethers.getContractAt("Pool", poolAddress);
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

    async function premiumAppliedLongBuyShort(amount) {
      await attemptSwap(
        txSignerA,
        0,
        0x00,
        0x10,
        numberToWei(1),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      await attemptSwap(
        txSignerANoPremium,
        0,
        0x00,
        0x10,
        numberToWei(1),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      const shortWithPremium = await attemptStaticSwap(
        txSignerA,
        0,
        0x00,
        0x20,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      const shortWithoutPremium = await attemptStaticSwap(
        txSignerANoPremium,
        0,
        0x00,
        0x20,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      expect(shortWithPremium)
        .to.be.equal(shortWithoutPremium)
    }

    async function premiumAppliedShortBuyLong(amount) {
      await attemptSwap(
        txSignerA,
        0,
        0x00,
        0x20,
        numberToWei(1),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      await attemptSwap(
        txSignerANoPremium,
        0,
        0x00,
        0x20,
        numberToWei(1),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      const longWithPremium = await attemptStaticSwap(
        txSignerA,
        0,
        0x00,
        0x10,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      const longWithoutPremium = await attemptStaticSwap(
        txSignerANoPremium,
        0,
        0x00,
        0x10,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )


      expect(longWithPremium).to.be.equal(longWithoutPremium)
    }

    async function premiumBuyingLong(amount) {
      const state = await txSignerA.getStates()
      const price = await asymptoticPerpetual.$_selectPrice(
        config,
        state,
        0x00,
        0x10
      )

      const payload = abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [0, 0x00, 0x10, numberToWei(amount)]
      )

      const state1 = await stateCalHelper.swapToState(price.market, state, price.rA, price.rB, payload)

      const eval = await asymptoticPerpetual.$_evaluate(price.market, state1)
      const rA = eval.rA;
      const rB = eval.rB;
      const R = state1.R;
      const rC = R.sub(rA).sub(rB);
      const imbalanceRate = rA.sub(rB).mul(bn(1).shl(128)).div(rC)

      const longWithPremium = await attemptStaticSwap(
        txSignerA,
        0,
        0x00,
        0x10,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      const longWithoutPremium = await attemptStaticSwap(
        txSignerANoPremium,
        0,
        0x00,
        0x10,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      expect(Number(weiToNumber(longWithPremium.mul(imbalanceRate).div(config.PREMIUM_RATE))))
        .to.be.closeTo(
          Number(weiToNumber(longWithoutPremium)), 0.00001
        )
    }

    async function premiumBuyingShort(amount) {
      const state = await txSignerA.getStates()
      const price = await asymptoticPerpetual.$_selectPrice(
        config,
        state,
        0x00,
        0x20
      )

      const payload = abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [0, 0x00, 0x20, numberToWei(amount)]
      )

      const state1 = await stateCalHelper.swapToState(price.market, state, price.rA, price.rB, payload)

      const eval = await asymptoticPerpetual.$_evaluate(price.market, state1)
      const rA = eval.rA;
      const rB = eval.rB;
      const R = state1.R;
      const rC = R.sub(rA).sub(rB);
      const imbalanceRate = rB.sub(rA).mul(bn(1).shl(128)).div(rC)

      const shortWithPremium = await attemptStaticSwap(
        txSignerA,
        0,
        0x00,
        0x20,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      const shortWithoutPremium = await attemptStaticSwap(
        txSignerANoPremium,
        0,
        0x00,
        0x20,
        numberToWei(amount),
        stateCalHelper.address,
        '0x0000000000000000000000000000000000000000',
        accountA.address
      )

      expect(Number(weiToNumber(shortWithPremium.mul(imbalanceRate).div(config.PREMIUM_RATE))))
        .to.be.closeTo(
          Number(weiToNumber(shortWithoutPremium)), 0.00001
        )
    }

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
      asymptoticPerpetual,
      config,
      params,
      premiumBuyingLong,
      premiumBuyingShort,
      premiumAppliedLongBuyShort,
      premiumAppliedShortBuyLong
    }
  }

  it("RiskFactory > PremiumRate: Buy long 1e", async function () {
    const { premiumBuyingLong } = await loadFixture(fixture)
    await premiumBuyingLong(1)
  })

  it("RiskFactory > PremiumRate: Buy long 0.5e", async function () {
    const { premiumBuyingLong } = await loadFixture(fixture)
    await premiumBuyingLong(0.5)
  })

  it("RiskFactory > PremiumRate: Buy long 2e", async function () {
    const { premiumBuyingLong } = await loadFixture(fixture)
    await premiumBuyingLong(2)
  })

  it("RiskFactory > PremiumRate: Buy short 0.1e", async function () {
    const { premiumAppliedLongBuyShort } = await loadFixture(fixture)
    await premiumAppliedLongBuyShort(0.1)
  })

  it("RiskFactory ≤ PremiumRate: Buy long 0.1e", async function () {
    const {txSignerA, txSignerANoPremium, stateCalHelper, accountA} = await loadFixture(fixture)

    const withPremium = await attemptStaticSwap(
      txSignerA,
      0,
      0x00,
      0x10,
      numberToWei(0.1),
      stateCalHelper.address,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    )

    const withoutPremium = await attemptStaticSwap(
      txSignerANoPremium,
      0,
      0x00,
      0x10,
      numberToWei(0.1),
      stateCalHelper.address,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    )

    expect(withPremium)
      .to.be.equal(withoutPremium)
  })

  it("RiskFactory ≥ -PremiumRate:  Buy short 0.1e", async function () {
    const {txSignerA, txSignerANoPremium, stateCalHelper, accountA} = await loadFixture(fixture)

    const withPremium = await attemptStaticSwap(
      txSignerA,
      0,
      0x00,
      0x20,
      numberToWei(0.1),
      stateCalHelper.address,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    )

    const withoutPremium = await attemptStaticSwap(
      txSignerANoPremium,
      0,
      0x00,
      0x20,
      numberToWei(0.1),
      stateCalHelper.address,
      '0x0000000000000000000000000000000000000000',
      accountA.address
    )

    expect(withPremium)
      .to.be.equal(withoutPremium)
  })

  it("RiskFactory < -PremiumRate: Buy short 1e", async function () {
    const { premiumBuyingShort } = await loadFixture(fixture)
    await premiumBuyingShort(1)
  })

  it("RiskFactory < -PremiumRate: Buy short 0.5e", async function () {
    const { premiumBuyingShort } = await loadFixture(fixture)
    await premiumBuyingShort(0.5)
  })

  it("RiskFactory < -PremiumRate: Buy short 2e", async function () {
    const { premiumBuyingShort } = await loadFixture(fixture)
    await premiumBuyingShort(2)
  })

  it("RiskFactory < -PremiumRate: Buy long 0.1e", async function () {
    const { premiumAppliedShortBuyLong } = await loadFixture(fixture)
    await premiumAppliedShortBuyLong(0.1)
  })
})
