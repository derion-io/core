const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const { bn, encodePowers } = require("../test/shared/utilities");
const { MaxUint256, AddressZero } = ethers.constants;
const SECONDS_PER_YEAR = 31536000;
const opts = {
    gasLimit: 30000000
};
const fe = (x) => Number(ethers.utils.formatEther(x));
const pe = (x) => ethers.utils.parseEther(String(x));

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
    // UNISWAP
    // weth test
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
    // uniswap factory
    const compiledUniswapFactory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.interface, compiledUniswapFactory.bytecode, signer);
    // uniswap router
    const compiledUniswapRouter = require("@uniswap/v2-periphery/build/UniswapV2Router02");
    const UniswapRouter = await new ethers.ContractFactory(compiledUniswapRouter.abi, compiledUniswapRouter.bytecode, signer);
    // erc20 factory
    const compiledERC20 = require("@openzeppelin/contracts/build/contracts/ERC20PresetFixedSupply.json");
    const erc20Factory = new ethers.ContractFactory(compiledERC20.abi, compiledERC20.bytecode, signer);
    // setup uniswap
    const busd = await erc20Factory.deploy("USDC", "USDC", pe("200000000"), owner.address);
    console.log(`busd: ${busd.address}`);
    addressList["busd"] = busd.address;

    const weth = await WETH.deploy();
    console.log(`weth: ${weth.address}`);
    addressList["weth"] = weth.address;
    const uniswapFactory = await UniswapFactory.deploy(busd.address);
    console.log(`uniswapFactory: ${uniswapFactory.address}`);
    addressList["uniswapFactory"] = uniswapFactory.address;
    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address);
    console.log(`uniswapRouter: ${uniswapRouter.address}`);
    addressList["uniswapRouter"] = uniswapRouter.address;

    const a = await busd.approve(uniswapRouter.address, MaxUint256);
    a.wait(1);

    await uniswapRouter.addLiquidityETH(
        busd.address,
        '10480444925500000000000000',
        '10480444925000000000000000',
        '6986963283651477901852',
        owner.address,
        new Date().getTime() + 100000,
        {
            value: '6986963283651477901852',
        }
    );
    const pairAddresses = await uniswapFactory.allPairs(0);
    const uniswapPool = new ethers.Contract(pairAddresses, require("@uniswap/v2-core/build/UniswapV2Pair.json").abi, signer);
    console.log(`uniswapPool: ${uniswapPool.address}`);
    addressList["uniswapPool"] = uniswapPool.address;

    // deploy token1155
    const Token = await ethers.getContractFactory("Token");
    const derivable1155 = await Token.deploy(
        "Test/"
    );
    console.log(`token: ${derivable1155.address}`);
    addressList["token"] = derivable1155.address;
    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy(
        derivable1155.address
    );
    console.log(`poolFactory: ${poolFactory.address}`);
    addressList["poolFactory"] = poolFactory.address;
    // deploy Logic
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
    console.log(`logic: ${asymptoticPerpetual.address}`);
    addressList["logic"] = asymptoticPerpetual.address;

    // deploy pool
    const params = {
        logic: asymptoticPerpetual.address,
        tokenOracle: pairAddresses,
        tokenCollateral: weth.address,
        recipient: owner.address,
        markPrice: "7788445287819172527008699396495269118",
        power: 2,
        a: pe("1"),
        b: pe("1")
    }
    const poolAddress = await poolFactory.computePoolAddress(params);
    await weth.deposit({value: pe("1000")});
    await weth.transfer(poolAddress, pe("10"));
    const res = await poolFactory.createPool(params);
    res.wait(1);
    const derivablePool = await ethers.getContractAt("Pool", await poolFactory.computePoolAddress(params));
    console.log(`pool: ${derivablePool.address}`);
    addressList["pool"] = derivablePool.address;

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
    const tx = await testPrice.testFetchPrice(pairAddresses, weth.address);
    await tx.wait(1);
    // get price before update price
    // base price = 1, naive price = 1, cumulative price = 1
    const initPrice = formatFetchPriceResponse(await testPrice.callStatic.testFetchPrice(pairAddresses, weth.address));
    console.log("initPrice: ", initPrice);
}

function convertFixedToNumber(fixed) {
    const unit = 10000000;

    return bn(fixed)
        .mul(unit)
        .shr(112)
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
