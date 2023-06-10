const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { _init } = require("./shared/AsymptoticPerpetual")
chai.use(solidity)
const expect = chai.expect
const { AddressZero, MaxUint256 } = ethers.constants
const { bn, numberToWei, packId, encodeSqrtX96, decodeDataURI, feeToOpenRate } = require("./shared/utilities")

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
        const [owner, accountA, accountB] = await ethers.getSigners();
        const signer = owner;
        // deploy oracle library
        const OracleLibrary = await ethers.getContractFactory("TestOracleHelper")
        const oracleLibrary = await OracleLibrary.deploy()
        await oracleLibrary.deployed()
        // deploy pool factory
        const PoolFactory = await ethers.getContractFactory("PoolFactory")
        const poolFactory = await PoolFactory.deploy(owner.address)
        // deploy UTR
        const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
        const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
        const utr = await UniversalRouter.deploy()
        await utr.deployed()

        // deploy descriptor
        const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
        const tokenDescriptor = await TokenDescriptor.deploy()
        await tokenDescriptor.deployed()

        // deploy token1155
        const Token = await ethers.getContractFactory("Token")
        const derivable1155 = await Token.deploy(
            utr.address,
            owner.address,
            tokenDescriptor.address
        )
        await derivable1155.deployed()
        // erc20 factory
        const erc20Factory = await ethers.getContractFactory("USDC");
        const usdc = await erc20Factory.deploy(numberToWei('100000000000000000000'));
        await usdc.deployed()
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
            token0: quoteTokenIndex ? weth.address : usdc.address,
            token1: quoteTokenIndex ? usdc.address : weth.address,
            fee: 500,
            tickLower: Math.ceil(-887272 / 10) * 10,
            tickUpper: Math.floor(887272 / 10) * 10,
            amount0Desired: quoteTokenIndex ? pe('100') : pe('150000'),
            amount1Desired: quoteTokenIndex ? pe('150000') : pe('100'),
            amount0Min: 0,
            amount1Min: 0,
            recipient: owner.address,
            deadline: new Date().getTime() + 100000
        }, {
            value: pe('100'),
            gasLimit: 30000000
        })
        await time.increase(1000);
        // deploy ddl pool
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
            halfLife: bn(HALF_LIFE),
            premiumRate: '0',
            minExpirationD: 0,
            minExpirationC: 0,
            discountRate: 0,
            feeHalfLife: 0,
            openRate: feeToOpenRate(0)
        }
        params = await _init(oracleLibrary, pe("5"), params)
        const poolAddress = await poolFactory.computePoolAddress(params)
        await weth.deposit({
            value: pe("10000000000000000000")
        })
        await weth.transfer(poolAddress, pe("5"));
        await poolFactory.createPool(params);
        const derivablePool = await ethers.getContractAt("AsymptoticPerpetual", await poolFactory.computePoolAddress(params))
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

        // setup accA
        await weth.connect(accountA).deposit({
            value: pe("10000000000000000000")
        })
        await usdc.transfer(accountA.address, pe("10000000000000000000"))
        // setup accB
        await weth.connect(accountB).deposit({
            value: pe("10000000000000000000")
        })
        await usdc.transfer(accountB.address, pe("10000000000000000000"))
        return {
            owner,
            accountA,
            accountB,
            weth,
            usdc,
            utr,
            uniswapFactory,
            derivablePool,
            derivable1155,
            uniswapRouter,
            derivableHelper,
            uniswapPositionManager,
            stateCalHelper
        }
    }

    function convertId(side, poolAddress) {
        switch (side) {
            case SIDE_R:
                return packId(SIDE_R, poolAddress)
            case SIDE_A:
                return packId(SIDE_A, poolAddress)
            case SIDE_B:
                return packId(SIDE_B, poolAddress)
            case SIDE_C:
                return packId(SIDE_C, poolAddress)
            default:
                return 0
        }
    }

    describe("Token Shadow Metadata", function () {
        it("Shadow Name", async function () {
            const {
                derivablePool,
                derivable1155
            } = await loadFixture(deployDDLv2)

            const longName = await derivable1155.getShadowName(convertId(SIDE_A, derivablePool.address))
            const shortName = await derivable1155.getShadowName(convertId(SIDE_B, derivablePool.address))
            const cpName = await derivable1155.getShadowName(convertId(SIDE_C, derivablePool.address))

            expect(longName).to.be.equals('Long 2.5x WETH/USDC (WETH)')
            expect(shortName).to.be.equals('Short 2.5x WETH/USDC (WETH)')
            expect(cpName).to.be.equals('LP 2.5x WETH/USDC (WETH)')
        })

        it("Shadow Symbol", async function () {
            const {
                derivablePool,
                derivable1155
            } = await loadFixture(deployDDLv2)

            const longSymbol = await derivable1155.getShadowSymbol(convertId(SIDE_A, derivablePool.address))
            const shortSymbol = await derivable1155.getShadowSymbol(convertId(SIDE_B, derivablePool.address))
            const lpSymbol = await derivable1155.getShadowSymbol(convertId(SIDE_C, derivablePool.address))

            expect(longSymbol).to.be.equals('WETH+2.5xWETH/USDC')
            expect(shortSymbol).to.be.equals('WETH-2.5xWETH/USDC')
            expect(lpSymbol).to.be.equals('WETH(LP)2.5xWETH/USDC')
        })

        it("Shadow Decimals", async function () {
            const {
                derivablePool,
                derivable1155
            } = await loadFixture(deployDDLv2)

            const longDecimals = await derivable1155.getShadowDecimals(convertId(SIDE_A, derivablePool.address))
            const shortDecimals = await derivable1155.getShadowDecimals(convertId(SIDE_B, derivablePool.address))
            const lpDecimals = await derivable1155.getShadowDecimals(convertId(SIDE_C, derivablePool.address))

            expect(longDecimals).to.be.equals(18)
            expect(shortDecimals).to.be.equals(18)
            expect(lpDecimals).to.be.equals(18)
        })

        it("Token name (symbol)", async function () {
            const {
                derivable1155
            } = await loadFixture(deployDDLv2)
            expect(await derivable1155.name()).to.be.equals('Derivable Position')
            expect(await derivable1155.symbol()).to.be.equals('DERIVABLE-POS')
        })

        it("Token metadata", async function () {
            const {
                derivablePool,
                derivable1155
            } = await loadFixture(deployDDLv2)
            const logosvg = '<svg width="148" height="137" viewBox="0 0 148 137" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M80.0537 108.183V136.31H0V0H84.1578C114.181 0 147.129 23.5 147.129 69.2369H119.001C119.001 47.5 103.681 29.0301 84.1578 29.0301H28.7107V108.183H80.0537Z" fill="#01A7FA"/>' +
                '<mask id="path-2-inside-1_164_13183" fill="white">' +
                '<path fill-rule="evenodd" clip-rule="evenodd" d="M56.255 51.9277H88.7098V77.0548L105.473 90.8735H147.128V136.31H99.5281V99.3905L81.322 84.3825H56.255V51.9277Z"/>' +
                '</mask>' +
                '<path fill-rule="evenodd" clip-rule="evenodd" d="M56.255 51.9277H88.7098V77.0548L105.473 90.8735H147.128V136.31H99.5281V99.3905L81.322 84.3825H56.255V51.9277Z" fill="#F2F2F2"/>' +
                '<path d="M88.7098 51.9277H89.2098V51.4277H88.7098V51.9277ZM56.255 51.9277V51.4277H55.755V51.9277H56.255ZM88.7098 77.0548H88.2098V77.2906L88.3918 77.4406L88.7098 77.0548ZM105.473 90.8735L105.155 91.2593L105.294 91.3735H105.473V90.8735ZM147.128 90.8735H147.628V90.3735H147.128V90.8735ZM147.128 136.31V136.81H147.628V136.31H147.128ZM99.5281 136.31H99.0281V136.81H99.5281V136.31ZM99.5281 99.3905H100.028V99.1547L99.8461 99.0047L99.5281 99.3905ZM81.322 84.3825L81.64 83.9967L81.5015 83.8825H81.322V84.3825ZM56.255 84.3825H55.755V84.8825H56.255V84.3825ZM88.7098 51.4277H56.255V52.4277H88.7098V51.4277ZM89.2098 77.0548V51.9277H88.2098V77.0548H89.2098ZM88.3918 77.4406L105.155 91.2593L105.791 90.4877L89.0279 76.669L88.3918 77.4406ZM147.128 90.3735H105.473V91.3735H147.128V90.3735ZM147.628 136.31V90.8735H146.628V136.31H147.628ZM99.5281 136.81H147.128V135.81H99.5281V136.81ZM99.0281 99.3905V136.31H100.028V99.3905H99.0281ZM99.8461 99.0047L81.64 83.9967L81.0039 84.7684L99.21 99.7763L99.8461 99.0047ZM56.255 84.8825H81.322V83.8825H56.255V84.8825ZM55.755 51.9277V84.3825H56.755V51.9277H55.755Z" fill="#01A7FA" mask="url(#path-2-inside-1_164_13183)"/>' +
                '</svg>'
            const longMetadata = await derivable1155.uri(convertId(SIDE_A, derivablePool.address))
            const shortMetadata = await derivable1155.uri(convertId(SIDE_B, derivablePool.address))
            const lpMetadata = await derivable1155.uri(convertId(SIDE_C, derivablePool.address))

            // longMetadata
            expect(decodeDataURI(longMetadata).name).to.be.equals('Long 2.5x WETH/USDC (WETH)')
            expect(decodeDataURI(longMetadata).description).to.be.equals('This fungible token represents a Derivable LONG x2.5 position for the WETH/USDC pool at '
                + derivablePool.address.toLowerCase() + ' with WETH as the reserve token.')
            expect(decodeDataURI(longMetadata).image.substring(26)).to.be.equals(Buffer.from(logosvg).toString('base64'))

            // shortMetadata
            expect(decodeDataURI(shortMetadata).name).to.be.equals('Short 2.5x WETH/USDC (WETH)')
            expect(decodeDataURI(shortMetadata).description).to.be.equals('This fungible token represents a Derivable SHORT x2.5 position for the WETH/USDC pool at '
                + derivablePool.address.toLowerCase() + ' with WETH as the reserve token.')
            expect(decodeDataURI(shortMetadata).image.substring(26)).to.be.equals(Buffer.from(logosvg).toString('base64'))

            // lpMetadata
            expect(decodeDataURI(lpMetadata).name).to.be.equals('LP 2.5x WETH/USDC (WETH)')
            expect(decodeDataURI(lpMetadata).description).to.be.equals('This is a Derivable Liquidity Provider token for the WETH/USDC x2.5 pool at '
                + derivablePool.address.toLowerCase() + ' with WETH as the reserve token.')
            expect(decodeDataURI(lpMetadata).image.substring(26)).to.be.equals(Buffer.from(logosvg).toString('base64'))
        })

        it("Descriptor can only be set by setter", async function () {
            const {
                derivable1155,
                accountA
            } = await loadFixture(deployDDLv2)

            const txSignerA = await derivable1155.connect(accountA)
            await expect(txSignerA.setDescriptor(accountA.address)).to.be.revertedWith('UNAUTHORIZED')
            await expect(txSignerA.setDescriptorSetter(accountA.address)).to.be.revertedWith('UNAUTHORIZED')
        })
    })
})

