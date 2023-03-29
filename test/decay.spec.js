const {
    time,
    loadFixture,
  } = require("@nomicfoundation/hardhat-network-helpers");
  const {expect} = require("chai");
  const {bn, getDeltaSupply, numberToWei, packId, unpackId, encodeSqrtX96} = require("./shared/utilities");
  
  const opts = {
    gasLimit: 30000000
  }
  
  const HALF_LIFE = 10*365*24*60*60
  
  describe("Decay funding rate", function () {
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
  
        const oracle = bn(1).shl(255).add(bn(300).shl(256-64)).add(uniswapPair.address).toHexString()
        const params = {
            token: derivable1155.address,
            logic: asymptoticPerpetual.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(1500).shl(112),
            k: 5,
            a: numberToWei(0.3),
            b: numberToWei(0.3),
            halfLife: HALF_LIFE // ten years
        }
  
        const poolAddress = await poolFactory.computePoolAddress(params);
        const txSigner = weth.connect(otherAccount);
        await txSigner.deposit({
          value: '100000000000000000000000000000'
        })
        await weth.deposit({
          value: '100000000000000000000000000000'
        })
        await weth.transfer(poolAddress, numberToWei(1));
  
        await poolFactory.createPool(params);
  
        const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params));
  
        return {
            owner,
            weth,
            derivablePool,
            derivable1155,
            otherAccount
        }
    }
  
    describe("Pool", function () {
        it("Decay", async function () {
            const {owner, otherAccount, weth, derivablePool, derivable1155} = await loadFixture(deployDDLv2);
            await time.increase(100);
            const A_ID = packId(0x10, derivablePool.address);
            const B_ID = packId(0x20, derivablePool.address);
            const R_ID = packId(0x00, derivablePool.address);
            await weth.approve(derivablePool.address, '100000000000000000000000000');
            let txSigner = weth.connect(otherAccount);
            await txSigner.approve(derivablePool.address, '100000000000000000000000000');
            txSigner = derivable1155.connect(otherAccount);
            await txSigner.setApprovalForAll(derivablePool.address, true);
            derivable1155.setApprovalForAll(derivablePool.address, true);
            await derivablePool.exactIn(
              0x00,
              numberToWei(0.01),
              0x10,
              owner.address
            );
            txSigner = derivablePool.connect(otherAccount);
            await txSigner.exactIn(
              0x00,
              numberToWei(0.01),
              0x20,
              otherAccount.address
            );
            
            await time.increase(HALF_LIFE)
            const ownerTokenAmount = await derivable1155.balanceOf(owner.address, A_ID)
            const otherTokenAmount = await derivable1155.balanceOf(otherAccount.address, B_ID)
  
            const longBefore = await derivablePool.callStatic.exactIn(
              0x10,
              ownerTokenAmount,
              0x00,
              owner.address
            );
  
            const shortBefore = await txSigner.callStatic.exactIn(
              0x20,
              otherTokenAmount,
              0x00,
              owner.address
            );
            await time.increase(HALF_LIFE)
  
            const longAfter = await derivablePool.callStatic.exactIn(
              0x10,
              ownerTokenAmount,
              0x00,
              owner.address
            );
            const shortAfter = await txSigner.callStatic.exactIn(
              0x20,
              otherTokenAmount,
              0x00,
              owner.address
            );
            expect(shortBefore.div(2).eq(shortAfter)).to.be.true
            expect(longBefore.div(2).eq(longAfter)).to.be.true
        })
    });
  })