const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { numberToWei, encodeSqrtX96 } = require("./shared/utilities");
const { MaxUint256 } = require("@ethersproject/constants");

const PAYMENT = 0;

describe("UniV3 Wrapper", function () {
  const fixture = async function () {
    const [owner, accountA, accountB] = await ethers.getSigners();
    const signer = owner;

    // deploy UTR
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json");
    const UniversalRouter = new ethers.ContractFactory(
      UTR.abi,
      UTR.bytecode,
      owner
    );
    const utr = await UniversalRouter.deploy();
    await utr.deployed();

    // USDC
    const erc20Factory = await ethers.getContractFactory("USDC");
    const usdc = await erc20Factory.deploy(
      numberToWei("100000000000000000000")
    );

    // WETH
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json");
    const WETH = await new ethers.ContractFactory(
      compiledWETH.abi,
      compiledWETH.bytecode,
      signer
    );
    const weth = await WETH.deploy();
    await weth.deposit({
      value: numberToWei("10000000000000000000"),
    });

    const initPrice = 1500;
    const quoteTokenIndex =
      weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0;
    const initPriceX96 = encodeSqrtX96(
      quoteTokenIndex ? initPrice : 1,
      quoteTokenIndex ? 1 : initPrice
    );

    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
    const UniswapFactory = await new ethers.ContractFactory(
      compiledUniswapFactory.abi,
      compiledUniswapFactory.bytecode,
      signer
    );
    const uniswapFactory = await UniswapFactory.deploy();
    // uniswap PM
    const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
    const Uniswapv3PositionManager = new ethers.ContractFactory(
      compiledUniswapv3PositionManager.abi,
      compiledUniswapv3PositionManager.bytecode,
      signer
    );
    // setup uniswap
    const uniswapPositionManager = await Uniswapv3PositionManager.deploy(
      uniswapFactory.address,
      weth.address,
      "0x0000000000000000000000000000000000000000"
    );
    await uniswapFactory.createPool(usdc.address, weth.address, 500);
    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
    const pairAddress = await uniswapFactory.getPool(
      usdc.address,
      weth.address,
      500
    );
    const uniswapPair = new ethers.Contract(
      pairAddress,
      compiledUniswapPool.abi,
      signer
    );

    const a = await uniswapPair.initialize(initPriceX96);
    a.wait(1);

    // add liquidity
    await usdc.approve(uniswapPositionManager.address, MaxUint256);
    await weth.approve(uniswapPositionManager.address, MaxUint256);
    await uniswapPositionManager.mint(
      {
        token0: quoteTokenIndex ? weth.address : usdc.address,
        token1: quoteTokenIndex ? usdc.address : weth.address,
        fee: 500,
        tickLower: Math.ceil(-887272 / 10) * 10,
        tickUpper: Math.floor(887272 / 10) * 10,
        amount0Desired: quoteTokenIndex
          ? numberToWei("100")
          : numberToWei("150000"),
        amount1Desired: quoteTokenIndex
          ? numberToWei("150000")
          : numberToWei("100"),
        amount0Min: 0,
        amount1Min: 0,
        recipient: owner.address,
        deadline: new Date().getTime() + 100000,
      },
      {
        value: numberToWei("100"),
        gasLimit: 30000000,
      }
    );
    await time.increase(1000);

    // DEPLOY UNIV3WRAPPER
    const UniV3ERC20WrapperFactory = await ethers.getContractFactory(
      "UniV3ERC20WrapperFactory"
    );
    const uniV3ERC20WrapperFactory = await UniV3ERC20WrapperFactory.deploy(
      uniswapFactory.address,
      utr.address
    );

    const wrapperAddr =
      await uniV3ERC20WrapperFactory.callStatic.deployWrapperToken({
        pool: uniswapPair.address,
        tickLower: Math.ceil(-887272 / 10) * 10,
        tickUpper: Math.floor(887272 / 10) * 10,
      });

    await uniV3ERC20WrapperFactory.deployWrapperToken({
      pool: uniswapPair.address,
      tickLower: Math.ceil(-887272 / 10) * 10,
      tickUpper: Math.floor(887272 / 10) * 10,
    });

    const wrapper = await ethers.getContractAt(
      "UniV3ERC20Wrapper",
      wrapperAddr
    );

    await weth.approve(utr.address, ethers.constants.MaxUint256)
    await usdc.approve(utr.address, ethers.constants.MaxUint256)

    return {
      owner,
      utr,
      weth,
      usdc,
      wrapper,
      uniswapPair,
      uniV3ERC20WrapperFactory,
    };
  };

  it("Test", async function () {
    const {
      owner,
      utr,
      weth,
      usdc,
      uniswapPair,
      wrapper,
      uniV3ERC20WrapperFactory,
    } = await loadFixture(fixture);

    console.log('uniswapPair.address', uniswapPair.address)
    const quoteTokenIndex =
      weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0;

    await utr.exec(
      [],
      [
        {
          inputs: [
            {
              mode: PAYMENT,
              eip: 20,
              token: weth.address,
              id: 0,
              amountIn: numberToWei(1),
              recipient: uniswapPair.address,
            },
            {
              mode: PAYMENT,
              eip: 20,
              token: usdc.address,
              id: 0,
              amountIn: numberToWei(1500),
              recipient: uniswapPair.address,
            },
          ],
          code: uniV3ERC20WrapperFactory.address,
          data: (
            await uniV3ERC20WrapperFactory.populateTransaction.deposit({
              key: {
                pool: uniswapPair.address,
                tickLower: Math.ceil(-887272 / 10) * 10,
                tickUpper: Math.floor(887272 / 10) * 10,
              },
              amount0Desired: quoteTokenIndex
                ? numberToWei(1)
                : numberToWei(1500),
              amount1Desired: quoteTokenIndex
                ? numberToWei(1500)
                : numberToWei(1),
              amount0Min: 0,
              amount1Min: 0,
              deadline: 10000000000000,
              recipient: owner.address,
              payer: owner.address
            })
          ).data,
        },
      ]
    );
  });
});
