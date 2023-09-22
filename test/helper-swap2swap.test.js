const {
    loadFixture,
    time,
  } = require("@nomicfoundation/hardhat-network-helpers");
  const { loadFixtureFromParams } = require("./shared/scenerios");
  const { numberToWei, encodeSqrtX96, packId } = require("./shared/utilities");
  const { MaxUint256 } = require("@ethersproject/constants");
  const { baseParams } = require("./shared/baseParams");
  const { SIDE_R, SIDE_A } = require("./shared/constant");
  
  const PAYMENT = 0;
  
  
  describe("Helper swap2swap", function () {
    const fixture = loadFixtureFromParams(
      [
        {
          ...baseParams,
        },
      ],
      {
        initReserved: 1000,
        callback: async function ({ owner, weth, usdc }) {
          const signer = owner;
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
          const uniswapPairFee500 = new ethers.Contract(
            pairAddress,
            compiledUniswapPool.abi,
            signer
          );
  
          const quoteTokenIndex =
            weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0;
          const initPriceX96 = encodeSqrtX96(
            quoteTokenIndex ? 1500 : 1,
            quoteTokenIndex ? 1 : 1500
          );
          const a = await uniswapPairFee500.initialize(initPriceX96);
          a.wait(1);
          await time.increase(1000);
          // add liquidity
          await usdc.approve(uniswapPositionManager.address, MaxUint256);
          await weth.approve(uniswapPositionManager.address, MaxUint256);
          await uniswapPositionManager.mint(
            {
              token0: usdc.address,
              token1: weth.address,
              fee: 500,
              tickLower: Math.ceil(-887272 / 10) * 10,
              tickUpper: Math.floor(887272 / 10) * 10,
              amount0Desired: numberToWei("150000"),
              amount1Desired: numberToWei("100"),
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
          return {
            uniswapPairFee500,
          };
        },
      }
    );
  
    it("Swap and open", async function () {
      const {
        utr,
        uniswapPairFee500,
        stateCalHelper,
        usdc,
        owner,
        derivablePools,
      } = await loadFixture(fixture);
      const pool = derivablePools[0];
      await usdc.approve(utr.address, MaxUint256);
      await utr.exec(
        [],
        [
          {
            inputs: [
              {
                mode: PAYMENT,
                eip: 20,
                token: usdc.address,
                id: 0,
                amountIn: numberToWei(5),
                recipient: uniswapPairFee500.address,
              },
            ],
            flags: 0,
            code: stateCalHelper.address,
            data: (
              await stateCalHelper.populateTransaction.swapAndOpen(
                {
                  sideIn: SIDE_R,
                  sideOut: SIDE_A,
                  poolIn: pool.contract.address,
                  poolOut: pool.contract.address,
                  amountIn: numberToWei(5),
                  recipient: owner.address,
                  payer: owner.address,
                  INDEX_R: 0
                },
                usdc.address,
                uniswapPairFee500.address
              )
            ).data,
          },
        ]
      );
    });
  
    it("Close and swap", async function () {
      const {
        utr,
        uniswapPairFee500,
        stateCalHelper,
        derivable1155,
        usdc,
        owner,
        derivablePools,
      } = await loadFixture(fixture);
      const pool = derivablePools[0];
      const tokenId = packId(SIDE_A, pool.contract.address)
      await derivable1155.setApprovalForAll(utr.address, true)
      await usdc.approve(utr.address, MaxUint256);
      await utr.exec(
        [],
        [
          {
            inputs: [
              {
                mode: PAYMENT,
                eip: 1155,
                token: derivable1155.address,
                id: tokenId,
                amountIn: '10000000000',
                recipient: pool.contract.address,
              },
            ],
            flags: 0,
            code: stateCalHelper.address,
            data: (
              await stateCalHelper.populateTransaction.closeAndSwap(
                {
                  sideIn: SIDE_A,
                  sideOut: SIDE_R,
                  poolIn: pool.contract.address,
                  poolOut: pool.contract.address,
                  amountIn: '10000000000',
                  recipient: owner.address,
                  payer: owner.address,
                  INDEX_R: 0
                },
                usdc.address,
                uniswapPairFee500.address
              )
            ).data,
          },
        ]
      );
    });
  });
  