const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { ethers } = require("hardhat")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, encodePriceSqrt } = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
  gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

const MAX_INT = bn('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

describe("ShadowCloneERC20", function () {
  async function fixture() {
    const [owner, accountA] = await ethers.getSigners();
    const signer = owner;
    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory")
    const poolFactory = await PoolFactory.deploy()
    // deploy pool factory
    const TokenFactory = await ethers.getContractFactory("TokenFactory")
    const tokenFactory = await TokenFactory.deploy()
    // deploy UTR
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()
    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      "Test/",
      utr.address,
      tokenFactory.address
    )

    await derivable1155.deployed()
    // erc20 factory
    const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json");
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
    const usdc = await erc20Factory.deploy(numberToWei(10000000000));
    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer);
    const uniswapFactory = await UniswapFactory.deploy()
    //WETH
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
    const weth = await WETH.deploy();
    // uniswap router
    const compiledUniswapRouter = require("./compiled/SwapRouter.json");
    const UniswapRouter = new ethers.ContractFactory(compiledUniswapRouter.abi, compiledUniswapRouter.bytecode, signer);
    // setup uniswap
    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
    await uniswapFactory.createPool(usdc.address, weth.address, 500)
    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
    const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
    const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer);
    await usdc.approve(uniswapRouter.address, MaxUint256);
    await weth.approve(uniswapRouter.address, MaxUint256);
    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    const a = await uniswapPair.initialize(initPriceX96)
    a.wait(1);
    await time.increase(1000);

    // deploy logic
    const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")
    const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
    await asymptoticPerpetual.deployed()
    // deploy ddl pool
    const oracle = ethers.utils.hexZeroPad(
      bn(1).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
      32,
    )
    const params = {
      utr: utr.address,
      token: derivable1155.address,
      logic: asymptoticPerpetual.address,
      oracle,
      reserveToken: weth.address,
      recipient: owner.address,
      mark: bn(38).shl(112),
      k: 5,
      a: pe(10),
      b: pe(10),
      initTime: 0,
      halfLife: HALF_LIFE, // ten years
      minExpiration: 0,
      cMinExpiration: 0,
    }
    const poolAddress = await poolFactory.computePoolAddress(params)
    await weth.deposit({
      value: pe("1000000")
    })
    await weth.transfer(poolAddress, pe("10000"));
    await poolFactory.createPool(params);

    const TOKEN_ID = packId(SIDE_C, poolAddress)
    const tokenParams = {
      token: derivable1155.address,
      id: TOKEN_ID
    }
    await tokenFactory.createPool(tokenParams);
    const shadowToken = await ethers.getContractAt("ShadowCloneERC20", await tokenFactory.computePoolAddress(tokenParams))
    const derivablePool = await ethers.getContractAt("Pool", poolAddress)

    await weth.connect(accountA).deposit({
      value: pe("1000000")
    })
    await usdc.transfer(accountA.address, pe("100000000"))
    return {
      owner,
      accountA,
      weth,
      usdc,
      utr,
      uniswapFactory,
      derivablePool,
      derivable1155,
      uniswapRouter,
      shadowToken,
      TOKEN_ID
    }
  }

  it("Deploy", async function () {
    const {shadowToken, derivable1155, derivablePool} = await loadFixture(fixture)
    expect(await shadowToken.name()).equal("Shadow Clone")
    expect(await shadowToken.symbol()).equal("SCL")
    expect(await shadowToken.TOKEN1155()).equal(derivable1155.address)
    expect(await shadowToken.ID()).equal(packId(SIDE_C, derivablePool.address))
  })

  describe("Authorization", function () {
    it("Shouldn't allow arbitrary address to call proxySetApprovalForAll", async function () {
      const {derivable1155, accountA, owner} = await loadFixture(fixture)
      await expect(derivable1155.proxySetApprovalForAll(owner.address, accountA.address, true)).to.be.reverted
    })
    it("Shouldn't allow arbitrary address to call proxySafeTransferFrom", async function () {
      const {derivable1155, accountA, owner, TOKEN_ID} = await loadFixture(fixture)
      await expect(derivable1155.proxySafeTransferFrom(
        owner.address, 
        accountA.address, 
        TOKEN_ID, 
        '100'
      )).to.be.reverted
    })
  })

  describe("Approve", function () {
    it("Should approved for all ERC1155, when approve from ERC20", async function () {
      const {shadowToken, derivable1155, TOKEN_ID, accountA, owner} = await loadFixture(fixture)
      await shadowToken.approve(accountA.address, "20")
      expect(await derivable1155.isApprovedForAll(owner.address, accountA.address)).to.be.true
    })
    it("Should approve with max allowance ERC20, when approval for all ERC1155 ", async function () {
      const {shadowToken, derivable1155, TOKEN_ID, accountA, owner} = await loadFixture(fixture)
      await derivable1155.setApprovalForAll(accountA.address, true)
      expect(await shadowToken.allowance(owner.address, accountA.address)).to.be.equal(MAX_INT)
    })
  })

  describe("Transfer", function () {
    it("Should balance exact same between ERC20 and ERC1155", async function() {
      const {shadowToken, derivable1155, TOKEN_ID, accountA, owner} = await loadFixture(fixture)
      const erc20Balance = await shadowToken.balanceOf(owner.address)
      const erc1155Balance = await derivable1155.balanceOf(owner.address, TOKEN_ID)
      expect(erc20Balance).to.be.equal(erc1155Balance)
    })
    it("Transfer success from ERC20", async function () {
      const {shadowToken, derivable1155, TOKEN_ID, accountA, owner} = await loadFixture(fixture)
      const erc20BalanceBefore = await shadowToken.balanceOf(owner.address)
      await shadowToken.transfer(accountA.address, "100")
      const erc20BalanceAfter = await shadowToken.balanceOf(owner.address)
      expect(erc20BalanceBefore.sub(erc20BalanceAfter)).to.be.equal(bn('100'))
      expect(await shadowToken.balanceOf(accountA.address)).to.be.equal(bn('100'))
    })
    it("Transfer exceed balance", async function () {
      const {shadowToken, derivable1155, TOKEN_ID, accountA, owner} = await loadFixture(fixture)
      const erc20BalanceBefore = await shadowToken.balanceOf(owner.address)
      await expect(
        shadowToken.transfer(accountA.address, erc20BalanceBefore.add(1).toString())
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      await expect(derivable1155.safeTransferFrom(
        owner.address, 
        accountA.address, 
        TOKEN_ID, 
        erc20BalanceBefore.add(1).toString(),
        0x0
      )).to.be.revertedWith('ERC1155: insufficient balance for transfer')
    })
    it("Transfer to contract", async function () {
      const {shadowToken, derivable1155, TOKEN_ID, uniswapFactory, owner} = await loadFixture(fixture)
      await shadowToken.transfer(uniswapFactory.address, '100');
      await expect(derivable1155.safeTransferFrom(
        owner.address, 
        uniswapFactory.address, 
        TOKEN_ID, 
        '100',
        0x0
      )).to.be.revertedWith('ERC1155: transfer to non-ERC1155Receiver implementer')
    })
  })
})