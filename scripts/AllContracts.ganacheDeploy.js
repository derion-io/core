const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const { bn } = require("../test/shared/utilities");
const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json");
const compiledUniswapv3Router = require("./compiled/SwapRouter.json");
const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json");
const {numberToWei, encodeSqrtX96, packId, delay} = require("./shared/utilities");
const compiledUniswapPool = require("./compiled/UniswapV3Pool.json");
const {time} = require("@nomicfoundation/hardhat-network-helpers");
const { MaxUint256, AddressZero } = ethers.constants;
const SECONDS_PER_YEAR = 31536000;
const opts = {
    gasLimit: 30000000
};
const fe = (x) => Number(ethers.utils.formatEther(x));
const pe = (x) => ethers.utils.parseEther(String(x));
const HALF_LIFE = 10 * 365 * 24 * 60 * 60

async function main() {
    const addressList = {
        "busd": "",
        "weth": "",
        "uniswapFactory": "",
        "uniswapRouter": "",
        "uniswapPool": "",
        "poolFactory": "",
        "token": "",
        "logic": "",
        "pool": "",
        "router": "",
        "testPrice": "",
        "tokenInfo": "",
        "pairDetails": "",
        "bna": "",
        "multicall3": ""
    };
    const [owner, acc1] = await ethers.getSigners();
    const signer = owner;

    // deploy utr
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()
    console.log('utr: ', utr.address)
    addressList["utr"] = utr.address;

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory")
    const poolFactory = await PoolFactory.deploy()
    console.log('poolFactory: ', poolFactory.address)
    addressList["poolFactory"] = poolFactory.address;

    // UNISWAP
    // weth test
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json")
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer)
    // uniswap router
    const compiledUniswapv3Router = require("./compiled/SwapRouter.json")
    const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer)
    // uniswap PM
    const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json")
    const UniswapPositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer)
    // erc20 factory
    const compiledERC20 = require("@uniswap/v2-core/build/ERC20.json")
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
    // setup uniswap
    const usdc = await erc20Factory.deploy(numberToWei(100000000000))
    const weth = await WETH.deploy()
    console.log('usdc: ', usdc.address)
    addressList["usdc"] = usdc.address;
    console.log('weth: ', weth.address)
    addressList["weth"] = weth.address;

    const uniswapFactory = await UniswapFactory.deploy()
    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address)
    console.log('uniswapRouter: ', uniswapRouter.address)
    addressList["uniswapRouter"] = uniswapRouter.address;
    const uniswapPositionManager = await UniswapPositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')
    console.log('uniswapPositionManager: ', uniswapPositionManager.address)
    addressList["uniswapPositionManager"] = uniswapPositionManager.address;

    await uniswapFactory.createPool(usdc.address, weth.address, 500)

    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json")
    const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
    const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer)

    await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256)
    await weth.approve(uniswapRouter.address, ethers.constants.MaxUint256)

    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    const a = await uniswapPair.initialize(initPriceX96)
    a.wait(1)

    // await time.increase(1000)
    await delay(1000)


    const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")

    const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
    await asymptoticPerpetual.deployed()
    console.log('logic: ', asymptoticPerpetual.address)
    addressList["logic"] = asymptoticPerpetual.address;

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
        "Test/",
        utr.address
    )
    console.log('token: ', derivable1155.address)
    addressList["token"] = derivable1155.address;
    await derivable1155.deployed()

    // deploy ddl pool
    const oracle = bn(1).shl(255).add(bn(1).shl(256 - 64)).add(uniswapPair.address).toHexString()
    const params = {
        utr: utr.address,
        token: derivable1155.address,
        logic: asymptoticPerpetual.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: '0x05dbdef6832deed3ff7964322f50a2d6',
        k: 5,
        a: numberToWei(1),
        b: numberToWei(1),
        halfLife: HALF_LIFE
    }
    const poolAddress = await poolFactory.computePoolAddress(params)
    await weth.deposit({
        value: pe("100")
    })
    await weth.transfer(poolAddress, pe("10"))
    await poolFactory.createPool(params, {
        gasLimit: 6000000
    })
    const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))
    console.log(`pool: ${derivablePool.address}`);
    addressList["pool"] = derivablePool.address;

    // deploy ddl pool
    const params1 = {
        utr: utr.address,
        token: derivable1155.address,
        logic: asymptoticPerpetual.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: '0x05dbdef6832deed3ff7964322f50a2d6',
        k: 2,
        a: numberToWei(1),
        b: numberToWei(1),
        halfLife: HALF_LIFE
    }
    const poolAddress1 = await poolFactory.computePoolAddress(params1)
    await weth.deposit({
        value: pe("100")
    })
    await weth.transfer(poolAddress1, pe("10"))
    await poolFactory.createPool(params1, {
        gasLimit: 6000000
    })
    const derivablePool1 = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params))
    console.log(`pool1: ${derivablePool1.address}`);
    addressList["pool1"] = derivablePool1.address;

    // deploy test price
    const TestPrice = await ethers.getContractFactory("TestPrice");
    const testPrice = await TestPrice.deploy();
    await testPrice.deployed();
    console.log(`testPrice: ${testPrice.address}`);
    addressList["testPrice"] = testPrice.address;

    // deploy utility contracts
    const TokenInfo = await hre.ethers.getContractFactory("TokenInfo");
    const tokenInfo = await TokenInfo.deploy();
    await tokenInfo.deployed();
    console.log(`tokenInfo: ${tokenInfo.address}`);
    addressList["tokenInfo"] = tokenInfo.address;
    const PairDetails = await hre.ethers.getContractFactory("PairDetails");
    const pairDetails = await PairDetails.deploy();
    await pairDetails.deployed();
    console.log(`pairDetails: ${pairDetails.address}`);
    addressList["pairDetails"] = pairDetails.address;
    const BnA = await hre.ethers.getContractFactory("BnA");
    const bna = await BnA.deploy();
    await bna.deployed();
    console.log(`bna: ${bna.address}`);
    addressList["bna"] = bna.address;
    const Multicall3 = await hre.ethers.getContractFactory("Multicall3");
    const multicall3 = await Multicall3.deploy();
    await multicall3.deployed();
    console.log(`multicall3: ${multicall3.address}`);
    addressList["multicall3"] = multicall3.address;

    exportData(addressList);
    // init pool store
    // const tx = await testPrice.testFetchPrice(pairAddresses, weth.address);
    // await tx.wait(1);
    // get price before update price
    // base price = 1, naive price = 1, cumulative price = 1
    // const initPrice = formatFetchPriceResponse(await testPrice.callStatic.testFetchPrice(pairAddresses, weth.address));
    // console.log("initPrice: ", initPrice);
}

function convertFixedToNumber(fixed) {
    const unit = 10000000;

    return bn(fixed)
        .mul(unit)
        .shr(128)
        .toNumber() / unit
}

function formatFetchPriceResponse(priceRes) {
    return {
        twap_base: convertFixedToNumber(priceRes.twap.base[0]),
        twap_LP: convertFixedToNumber(priceRes.twap.LP[0]),
        naive_base: convertFixedToNumber(priceRes.naive.base[0]),
        naive_LP: convertFixedToNumber(priceRes.naive.LP[0])
    }
}

function exportData(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2);
    fs.writeFileSync(path.join(__dirname, "AddressList.json"), json);
};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
