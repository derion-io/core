const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const {solidity} = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const {MaxUint256} = ethers.constants
const {
    bn,
    numberToWei,
    packId,
    encodeSqrtX96,
} = require("./shared/utilities")

const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
    gasLimit: 30000000
}

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

const FROM_ROUTER = 10;
const PAYMENT = 0;
const TRANSFER = 1;
const ALLOWANCE = 2;
const CALL_VALUE = 3;

const EIP_ETH = 0
const ERC_721_BALANCE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UniversalTokenRouter.ERC_721_BALANCE"))
const ACTION_IGNORE_ERROR = 1
const ACTION_RECORD_CALL_RESULT = 2
const ACTION_INJECT_CALL_RESULT = 4

const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("DDL v3", function () {
    async function deployDDLv2() {
        const [owner, accountA] = await ethers.getSigners();
        const signer = owner;
        // deploy pool factory
        const PoolFactory = await ethers.getContractFactory("PoolFactory")
        const poolFactory = await PoolFactory.deploy()
        // deploy UTR
        const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
        const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
        const utr = await UniversalRouter.deploy()
        await utr.deployed()
        // deploy token1155
        const Token = await ethers.getContractFactory("Token")
        const derivable1155 = await Token.deploy(
            "Test/",
            utr.address
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
        // uniswap PM
        const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
        const Uniswapv3PositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer);
        // setup uniswap
        const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
        const uniswapPositionManager = await Uniswapv3PositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')
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
        // add liquidity
        await usdc.approve(uniswapPositionManager.address, MaxUint256);
        await weth.approve(uniswapPositionManager.address, MaxUint256);
        await uniswapPositionManager.mint({
            token0: usdc.address,
            token1: weth.address,
            fee: 500,
            tickLower: Math.ceil(-887272 / 10) * 10,
            tickUpper: Math.floor(887272 / 10) * 10,
            amount0Desired: pe('150000'),
            amount1Desired: pe('100'),
            amount0Min: 0,
            amount1Min: 0,
            recipient: owner.address,
            deadline: new Date().getTime() + 100000
        }, {
            value: pe('100'),
            gasLimit: 30000000
        })
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
            a: pe(1),
            b: pe(1),
            halfLife: HALF_LIFE // ten years
        }
        const poolAddress = await poolFactory.computePoolAddress(params)
        await weth.deposit({
            value: pe("1000000")
        })
        await weth.transfer(poolAddress, pe("10000"));
        await poolFactory.createPool(params);
        const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))

        const params1 = {
            utr: utr.address,
            token: derivable1155.address,
            logic: asymptoticPerpetual.address,
            oracle,
            reserveToken: weth.address,
            recipient: owner.address,
            mark: bn(38).shl(112),
            k: 2,
            a: pe(1),
            b: pe(1),
            halfLife: HALF_LIFE // ten years
        }
        const poolAddress1 = await poolFactory.computePoolAddress(params1)
        await weth.deposit({
            value: pe("1000000")
        })
        await weth.transfer(poolAddress1, pe("10000"));
        await poolFactory.createPool(params1);
        const derivablePool1 = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params1))

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
        // setup accA
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
            derivablePool1,
            derivable1155,
            uniswapRouter,
            derivableHelper,
            uniswapPositionManager,
            stateCalHelper
        }
    }

    describe("Swap multi pool", function () {
        async function testSwapMultiPool(sideIn, amountIn, sideOut) {
            const {
                owner,
                weth,
                derivablePool,
                derivablePool1,
                utr,
                derivable1155,
                stateCalHelper
            } = await loadFixture(deployDDLv2)
            await weth.approve(derivablePool.address, MaxUint256)

            const balanceInBefore = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePool.address))
            const balanceOutBefore = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool1.address))
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 1155,
                    token: derivable1155.address,
                    id: packId(sideIn, derivablePool.address),
                    amountIn: pe(amountIn),
                    recipient: derivablePool.address,
                }],
                flags: 0,
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: sideIn,
                    poolIn: derivablePool.address,
                    sideOut: sideOut,
                    poolOut: derivablePool1.address,
                    amountIn: pe(amountIn),
                    payer: owner.address,
                    recipient: owner.address,
                    TOKEN: derivable1155.address
                })).data,
            }], opts)

            const balanceInAfter = await derivable1155.balanceOf(owner.address, packId(sideIn, derivablePool.address))
            const balanceOutAfter = await derivable1155.balanceOf(owner.address, packId(sideOut, derivablePool1.address))

            expect(balanceInBefore.sub(numberToWei(amountIn))).equal(balanceInAfter)
            expect(balanceOutBefore.lt(balanceOutAfter)).equal(true)
        }

        it("Pool0/A -> pool1/A", async function () {
            await testSwapMultiPool(SIDE_A, "1", SIDE_A)
        })
        it("Pool0/A -> pool1/B", async function () {
            await testSwapMultiPool(SIDE_A, "1", SIDE_B)
        })
        it("Pool0/A -> pool1/C", async function () {
            await testSwapMultiPool(SIDE_A, "1", SIDE_C)
        })
        it("Pool0/B -> pool1/A", async function () {
            await testSwapMultiPool(SIDE_B, "0.0001", SIDE_A)
        })
        it("Pool0/B -> pool1/B", async function () {
            await testSwapMultiPool(SIDE_B, "0.0001", SIDE_B)
        })
        it("Pool0/B -> pool1/C", async function () {
            await testSwapMultiPool(SIDE_B, "0.0001", SIDE_C)
        })
        it("Pool0/C -> pool1/A", async function () {
            await testSwapMultiPool(SIDE_C, "0.0001", SIDE_A)
        })
        it("Pool0/C -> pool1/B", async function () {
            await testSwapMultiPool(SIDE_C, "0.0001", SIDE_B)
        })
        it("Pool0/C -> pool1/C", async function () {
            await testSwapMultiPool(SIDE_C, "0.0001", SIDE_C)
        })
    })
})

