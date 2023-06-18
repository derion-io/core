const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { _evaluate, _selectPrice, _init } = require("./shared/AsymptoticPerpetual");
const { weiToNumber, bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96, encodePayload, attemptSwap, attemptStaticSwap, feeToOpenRate } = require("./shared/utilities");
const abiCoder = new ethers.utils.AbiCoder()
use(solidity)

const HALF_LIFE = 0;

const pe = (x) => ethers.utils.parseEther(String(x))

describe("Premium", function () {
  async function fixture() {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;

    // deploy oracle library
    const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
    const oracleLibrary = await OracleLibrary.deploy()
    await oracleLibrary.deployed()

    // deploy UTR
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy( owner.address );
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
      halfLife: bn(HALF_LIFE), // ten years
      premiumRate: '0',
      maturity: 0,
      maturityExp: 0,
      discountRate: 0,
      feeHalfLife: 0,
      openRate: feeToOpenRate(0)
    }
    params = await _init(oracleLibrary, pe("5"), params)
    const poolNoPremiumAddress = await poolFactory.computePoolAddress(params);
    await weth.transfer(poolNoPremiumAddress, pe("5"));
    await poolFactory.createPool(params);
    const derivablePoolNoPremium = await ethers.getContractAt("AsymptoticPerpetual", poolNoPremiumAddress);

    // deploy ddl pool premium
    params.premiumRate = bn(1).shl(128).div(2)
    const config = {
      TOKEN: derivable1155.address,
      TOKEN_R: weth.address,
      ORACLE: oracle,
      K: bn(5),
      MARK: bn(38).shl(128),
      INIT_TIME: bn(params.initTime),
      HALF_LIFE: bn(params.halfLife),
      PREMIUM_RATE: params.premiumRate
    }
    const poolAddress = await poolFactory.computePoolAddress(params);
    await weth.transfer(poolAddress, pe("5"));
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
      const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
      const price = _selectPrice(
        config, 
        state, 
        {min: oraclePrice.spot, max: oraclePrice.twap}, 
        0x00, 
        0x10, 
        bn(await time.latest())
      )

      const payload = abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [0, 0x00, 0x10, numberToWei(amount)]
      )

      const state1 = await stateCalHelper.swapToState(price.market, state, price.rA, price.rB, payload)

      const eval = _evaluate(price.market, state1)
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

      expect(longWithPremium, "premium taken").lt(longWithoutPremium)
      expect(longWithPremium, "premium taken").gte(
        longWithoutPremium.mul(config.PREMIUM_RATE).div(imbalanceRate).sub(20)
      )
      if (amount <= 1)
        expect(Number(weiToNumber(longWithPremium.mul(imbalanceRate).div(config.PREMIUM_RATE))))
          .to.be.closeTo(
            Number(weiToNumber(longWithoutPremium)), 0.00001
          )
    }

    async function premiumBuyingShort(amount) {
      const state = await txSignerA.getStates()
      const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
      const price = await _selectPrice(
        config,
        state,
        {min: oraclePrice.spot, max: oraclePrice.twap},
        0x00,
        0x20,
        bn(await time.latest())
      )

      const payload = abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [0, 0x00, 0x20, numberToWei(amount)]
      )

      const state1 = await stateCalHelper.swapToState(price.market, state, price.rA, price.rB, payload)

      const eval = _evaluate(price.market, state1)
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

      expect(shortWithPremium, "premium taken").lt(shortWithoutPremium)
      expect(shortWithPremium, "premium taken").gte(
        shortWithoutPremium.mul(config.PREMIUM_RATE).div(imbalanceRate).sub(20)
      )
      if (amount <= 1)
        expect(Number(weiToNumber(shortWithPremium.mul(imbalanceRate).div(config.PREMIUM_RATE))))
          .to.be.closeTo(
            Number(weiToNumber(shortWithoutPremium)), 0.00001
          )
    }

    async function fetchPrice() {
      const {spot, twap} = await oracleLibrary.fetch(params.oracle)
      if (spot.lt(twap)) 
        return {min: spot, max: twap}
      return {min: twap, max: spot}
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
      config,
      params,
      premiumBuyingLong,
      premiumBuyingShort,
      premiumAppliedLongBuyShort,
      premiumAppliedShortBuyLong,
      fetchPrice
    }
  }

  it("RiskFactor > PremiumRate: Buy long 1.7e", async function () {
    const { premiumBuyingLong } = await loadFixture(fixture)
    await premiumBuyingLong(1.7)
  })

  it("RiskFactor > PremiumRate: Buy long 3e", async function () {
    const { premiumBuyingLong } = await loadFixture(fixture)
    await premiumBuyingLong(3)
  })

  it("RiskFactor > PremiumRate: Buy long 2e", async function () {
    const { premiumBuyingLong } = await loadFixture(fixture)
    await premiumBuyingLong(2)
  })

  it("RiskFactor > PremiumRate: Buy short 0.1e", async function () {
    const { premiumAppliedLongBuyShort } = await loadFixture(fixture)
    await premiumAppliedLongBuyShort(0.1)
  })

  it("RiskFactor ≤ PremiumRate: Buy long 0.1e", async function () {
    const { txSignerA, txSignerANoPremium, stateCalHelper, accountA } = await loadFixture(fixture)

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

  it("RiskFactor ≥ -PremiumRate: Buy short 0.1e", async function () {
    const { txSignerA, txSignerANoPremium, stateCalHelper, accountA } = await loadFixture(fixture)

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

  it("RiskFactor < -PremiumRate: Buy short 3e", async function () {
    const { premiumBuyingShort } = await loadFixture(fixture)
    await premiumBuyingShort(3)
  })

  it("RiskFactor < -PremiumRate: Buy short 1.7e", async function () {
    const { premiumBuyingShort } = await loadFixture(fixture)
    await premiumBuyingShort(1.7)
  })

  it("RiskFactor < -PremiumRate: Buy short 2e", async function () {
    const { premiumBuyingShort } = await loadFixture(fixture)
    await premiumBuyingShort(2)
  })

  it("RiskFactor < -PremiumRate: Buy long 0.1e", async function () {
    const { premiumAppliedShortBuyLong } = await loadFixture(fixture)
    await premiumAppliedShortBuyLong(0.1)
  })
})
