const { ethers } = require("hardhat")
require('dotenv').config()
const { bn, feeToOpenRate, toHalfLife } = require("../test/shared/utilities")
const { calculateInitParamsFromPrice } = require("../test/shared/AsymptoticPerpetual")
const { AddressZero } = ethers.constants
const jsonUniswapV3Pool = require("./compiled/UniswapV3Pool.json");
const jsonERC20 = require("../artifacts/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json")
const { JsonRpcProvider } = ethers.providers

const pe = (x) => ethers.utils.parseEther(String(x))

const SECONDS_PER_HOUR = 60 * 60
const SECONDS_PER_DAY = SECONDS_PER_HOUR * 24

const Q256M = bn(1).shl(256).sub(1)

function compoundRate(r, k) {
    return 1 - (1-r)**k
}

function decompoundRate(c, k) {
    return 1 - (1-c)**(1/k)
}

const chainID = 42161
const SCAN_API_KEY = {
    42161: process.env.SCAN_API_KEY_42161,
}

const settings = {
    // pairAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',
    pairAddress: '0x8d76e9c2bd1adde00a3dcdc315fcb2774cb3d1d6',
    power: 10,
    interestRate: 0.03/100,
    premiumRate: 10/100,
    MATURITY: 60 * 60 * 12,
    vesting: 60,
    closingFeeDuration: 24*60*60,
    closingFee: 0.3/100,
    // reserveToken: undefined, // use the WETH
    // openingFee: 0/100,
    // R: 0.0001, // init liquidity
}

async function deploy(settings) {
    const configs = await fetch(
        `https://raw.githubusercontent.com/derivable-labs/configs/dev/${chainID}/network.json`
    ).then(res => res.json())

    const provider = new JsonRpcProvider(configs.rpc, chainID)
    const deployer = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
    const uniswapPair = new ethers.Contract(settings.pairAddress, jsonUniswapV3Pool.abi, provider)

    const [
        token0,
        token1,
        slot0,
    ] = await Promise.all([
        uniswapPair.callStatic.token0(),
        uniswapPair.callStatic.token1(),
        uniswapPair.callStatic.slot0(),
    ])

    const ct0 = new ethers.Contract(token0, jsonERC20.abi, provider)
    const ct1 = new ethers.Contract(token1, jsonERC20.abi, provider)
    const [
        decimals0,
        decimals1,
        symbol0,
        symbol1,
    ] = await Promise.all([
        ct0.callStatic.decimals(),
        ct1.callStatic.decimals(),
        ct0.callStatic.symbol(),
        ct1.callStatic.symbol(),
    ])

    // detect QTI
    let QTI
    if (QTI == null && symbol0.includes('USD')) {
        QTI = 0
    }
    if (QTI == null && symbol1.includes('USD')) {
        QTI = 1
    }
    if (QTI == null && configs.stablecoins.includes(token0)) {
        QTI = 0
    }
    if (QTI == null && configs.stablecoins.includes(token1)) {
        QTI = 1
    }
    if (QTI == null && configs.wrappedTokenAddress == token0) {
        QTI = 0
    }
    if (QTI == null && configs.wrappedTokenAddress == token1) {
        QTI = 1
    }
    if (QTI == null) {
        throw new Error('unable to detect QTI')
    }

    console.log('INDEX', QTI == 1 ? `${symbol0}/${symbol1}` : `${symbol1}/${symbol0}`, 'x'+settings.power)

    // detect WINDOW
    // get the block a day before
    const now = Math.floor(new Date().getTime() / 1000)
    const EPOCH = 500 * 60
    const anEpochAgo = now - EPOCH
    const blockEpochAgo = await fetch(
        `${configs.scanApi}?module=block&action=getblocknobytime&timestamp=${anEpochAgo}&closest=before&apikey=${SCAN_API_KEY[chainID]}`
    ).then(x => x.json()).then(x => Number(x?.result))

    const logs = await fetch(
        `${configs.scanApi}?module=logs&action=getLogs&address=${settings.pairAddress}&topic0=0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67&fromBlock=${blockEpochAgo}&apikey=${SCAN_API_KEY[chainID]}`
    ).then(x => x.json()).then(x => x?.result)

    if (!logs?.length) {
        throw new Error('no transaction for a whole day')
    }

    const txFreq = EPOCH / logs.length
    const WINDOW = Math.ceil(Math.sqrt(txFreq / 60)) * 60
    console.log('WINDOW', WINDOW / 60, 'min(s)')

    try {
        await uniswapPair.callStatic.observe([0, WINDOW])
    } catch(err) {
        if (err.reason == 'OLD') {
            throw new Error('WINDOW too long')
        }
        throw err
    }

    const ORACLE = ethers.utils.hexZeroPad(
        bn(QTI).shl(255).add(bn(WINDOW).shl(256 - 64)).add(settings.pairAddress).toHexString(),
        32,
    )

    let MARK = slot0.sqrtPriceX96.shl(32)
    if (QTI == 0) {
        MARK = Q256M.div(MARK)
    }

    const decDiff = decimals0 - decimals1

    let PRICE = MARK.mul(MARK)
    if (decDiff > 0)  {
        PRICE = PRICE.mul(10**decDiff)
    } else if (decDiff < 0) {
        PRICE = PRICE.div(10**decDiff)
    }
    if (PRICE.lt(Q256M)) {
        console.log('MARK', 10000 / Q256M.mul(10000).div(PRICE).toNumber())
    } else {
        console.log('MARK', PRICE.mul(10000).div(Q256M).toNumber() / 10000)
    }

    const DAILY_INTEREST_RATE = compoundRate(settings.interestRate, settings.power)
    const DAILY_PREMIUM_RATE = compoundRate(settings.premiumRate, settings.power)
    const INTEREST_HL = toHalfLife(DAILY_INTEREST_RATE)
    const PREMIUM_HL = toHalfLife(DAILY_PREMIUM_RATE)

    console.log('INTEREST_HL', (INTEREST_HL / SECONDS_PER_DAY).toFixed(2), 'day(s)')
    console.log('PREMIUM_HL', (PREMIUM_HL / SECONDS_PER_DAY).toFixed(2), 'day(s)')

    const config = {
        FETCHER: AddressZero,
        ORACLE,
        TOKEN_R: settings.reserveToken ?? configs.wrappedTokenAddress,
        MARK,
        K: bn(settings.power * 2),
        INTEREST_HL,
        PREMIUM_HL,
        MATURITY: settings.closingFeeDuration,
        MATURITY_VEST: settings.vesting,
        MATURITY_RATE: feeToOpenRate(settings.closingFee ?? 0),
        OPEN_RATE: feeToOpenRate(settings.openingFee ?? 0),
    }

    // console.log(config)

    // Create Pool
    // const poolFactory = await ethers.getContractAt("contracts/PoolFactory.sol:PoolFactory", configs.derivable.poolFactory, deployer)
    // const poolAddress = await poolFactory.callStatic.createPool(config)

    // init the pool
    const R = pe(settings.R ?? 0.0001)
    const state = await calculateInitParamsFromPrice(config, MARK, R)

    const helper = await ethers.getContractAt("contracts/support/Helper.sol:Helper", configs.derivable.helper ?? configs.derivable.stateCalHelper, deployer)

    let gas
    try {
        gas = await helper.estimateGas.createPool(
            config,
            state,
            configs.derivable.poolFactory,
            { value: R },
        )
    } catch(err) {
        if (err.reason != null) {
            throw new Error(err.reason)
        }
        throw err
    }

    console.log('Estimated Gas:', gas.toNumber().toLocaleString())

    const params = [
        config,
        state,
        configs.derivable.poolFactory,
        { value: R, gasLimit: gas.mul(3).div(2) },
    ]

    const poolAddress = await helper.callStatic.createPool(...params)
    console.log('New Pool Address:', poolAddress)

    console.log('> Enter to deploy, Ctrl-C to stop.');

    await waitForKey()

    console.log('Sending tx...')

    const tx = await helper.createPool(...params)

    console.log('Waiting for tx receipt...', tx.hash)
    
    const rec = await tx.wait()

    console.log(rec)
}

function waitForKey(keyCode = 10) {
    return new Promise(resolve => {
        process.stdin.on('data',function (chunk) {
            if (chunk[0] === keyCode) {
                resolve();
                process.stdin.pause();
            }
        });
    });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy(settings).catch((error) => {
    console.error(error)
    process.exitCode = 1
})
