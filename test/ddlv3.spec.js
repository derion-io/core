const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const {expect} = require("chai");
const {bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96} = require("./shared/utilities");

const opts = {
  gasLimit: 30000000
}

describe("DDL v3", function () {
  async function deployDDLv2() {
      const [owner, otherAccount] = await ethers.getSigners();
      const signer = owner;
      // deploy token1155
      const Token = await ethers.getContractFactory("Token");
      const derivable1155 = await Token.deploy(
          "Test/"
      );
      // deploy pool factory
      const PoolFactory = await ethers.getContractFactory("PoolFactory");
      const poolFactory = await PoolFactory.deploy(
          derivable1155.address
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
      await uniswapPair.initialize(initPriceX96)
      // await uniswapRouter.addLiquidity(
      //     usdc.address,
      //     eth.address,
      //     '10480444925500000000000000',
      //     '6986963283651477901852',
      //     '0',
      //     '0',
      //     owner.address,
      //     new Date().getTime() + 100000,
      //     opts
      // );
      // const pairAddresses = await uniswapFactory.allPairs(0);
      // const uniswapPool = new ethers.Contract(pairAddresses, require("@uniswap/v2-core/build/UniswapV2Pair.json").abi, signer);        // deploy Price Library
      
      const DerivableLibrary = await ethers.getContractFactory("DerivableLibrary", signer);
      const derivableLibrary = await DerivableLibrary.deploy();
      await derivableLibrary.deployed();
      
      const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual", {
          signer,
          libraries: {
              DerivableLibrary: derivableLibrary.address,
          },
      });

      const asymptoticPerpetual = await AsymptoticPerpetual.deploy();
      await asymptoticPerpetual.deployed();
      
      const params = {
          logic: asymptoticPerpetual.address,
          tokenOracle: pairAddress,
          tokenCollateral: weth.address,
          recipient: owner.address,
          markPrice: "7788445287819172527008699396495269118",
          time: 1,
          power: 2,
          a: numberToWei(1),
          b: numberToWei(1)
      }

      const poolAddress = await poolFactory.computePoolAddress(params);
      await weth.deposit({
        value: '100000000000000000000000000000'
      })
      await weth.transfer(poolAddress, numberToWei(10));

      await poolFactory.createPool(params);

      const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params));

      return {
          owner,
          weth,
          derivablePool,
          derivable1155
      }
  }

  describe("Pool", function () {
      it("Transition", async function () {
          const {owner, weth, derivablePool, derivable1155} = await loadFixture(deployDDLv2);
          await time.increase(100);
          const LP_ID = packId(0x30, derivablePool.address);
          console.log("R: ", await weth.balanceOf(derivablePool.address));
          console.log("LP: ", await derivable1155.balanceOf(owner.address, LP_ID));
          await derivablePool.transition(
              {R: numberToWei(10), a: numberToWei(0), b: numberToWei(1)},
              owner.address,
              opts
          );
          console.log("R: ", await weth.balanceOf(derivablePool.address));
          console.log("LP: ", await derivable1155.balanceOf(owner.address, LP_ID));
      })
  });
})