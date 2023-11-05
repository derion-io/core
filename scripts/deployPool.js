require('dotenv').config()
const mdp = require('move-decimal-point')
const { ethers } = require("hardhat")
const { AddressZero } = ethers.constants
const { bn, feeToOpenRate, numberToWei } = require("../test/shared/utilities")
const { calculateInitParamsFromPrice } = require("../test/shared/AsymptoticPerpetual")
const { JsonRpcProvider } = require("@ethersproject/providers");
const jsonUniswapV3Pool = require("./compiled/UniswapV3Pool.json")
const jsonUniswapV2Pool = require("@uniswap/v2-core/build/UniswapV2Pair.json")
const jsonERC20 = require("../artifacts/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json")
const { ADDRESS_ZERO } = require('@uniswap/v3-sdk')

const SECONDS_PER_HOUR = 60 * 60
const SECONDS_PER_DAY = SECONDS_PER_HOUR * 24
const PAYMENT = 0

const Q256M = bn(1).shl(256).sub(1)
const Q128 = bn(1).shl(128)

const PRECISION = 1000000

function rateToHL(r, k, DURATION = SECONDS_PER_DAY) {
    return Math.ceil(DURATION * Math.LN2 / r / k / k)
}

function rateFromHL(HL, k, DURATION = SECONDS_PER_DAY) {
    return DURATION * Math.LN2 / HL / k / k
}

const chainID = 56

const SCAN_API_KEY = {
    42161: process.env.ARBISCAN_API_KEY,
    56: process.env.BSCSCAN_API_KEY,
}

const SWAP_TOPIC = {
    2: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
    3: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
}

const gasPrices = {
    56: 3e9,
}

const gasPrice = gasPrices[chainID]

const settings = {
    // pairAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',
    // pairAddress: '0x8d76e9c2bd1adde00a3dcdc315fcb2774cb3d1d6',
    pairAddress: ['0x31C77F72BCc209AD00E3B7be13d719c08cb7BA7B'],
    windowBlocks: 120,
    power: 2,
    interestRate: 0.03 / 100,
    premiumRate: 0.3 / 100,
    MATURITY: 60 * 60 * 12,
    vesting: 60,
    closingFeeDuration: 24 * 60 * 60,
    closingFee: 0.3 / 100,
    reserveToken: 'PLD', // PlayDerivable
    // openingFee: 0/100,
    // R: 0.0001, // init liquidity
}

function findFetcher(fetchers, factory) {
    const fs = Object.keys(fetchers)
    let defaultFetcher
    for (const f of fs) {
        if (!fetchers[f].factory?.length) {
            defaultFetcher = [f, fetchers[f]?.type]
            continue
        }
        if (fetchers[f].factory?.includes(factory)) {
            return [f, fetchers[f]?.type]
        }
    }
    return defaultFetcher
}

async function deploy(settings) {
    const configs = await fetch(
        `https://raw.githubusercontent.com/derivable-labs/configs/dev/${chainID}/network.json`
    ).then(res => res.json())

    const TOKEN_R = settings.reserveToken == 'PLD'
        ? configs.derivable.playToken
        : settings.reserveToken ?? configs.wrappedTokenAddress

    if (TOKEN_R == configs.derivable.playToken) {
        console.log('TOKEN_R', 'PLD')
    } else if (TOKEN_R == configs.wrappedTokenAddress) {
        console.log('TOKEN_R', 'WETH')
    } else {
        console.log('TOKEN_R', TOKEN_R)
    }

    const provider = new JsonRpcProvider(configs.rpc, chainID)
    const deployer = new ethers.Wallet(process.env.MAINNET_DEPLOYER, provider);
    let uniswapPair = new ethers.Contract(settings.pairAddress[0], jsonUniswapV3Pool.abi, provider)

    const factory = await uniswapPair.callStatic.factory()
    const [FETCHER, fetcherType] = findFetcher(configs.fetchers, factory)
    const exp = fetcherType?.endsWith('3') ? 2 : 1
    if (exp == 1) {
        // use the univ2 abi
        uniswapPair = new ethers.Contract(settings.pairAddress[0], jsonUniswapV2Pool.abi, provider)
    }
    if (FETCHER != ADDRESS_ZERO) {
        console.log('FETCHER', FETCHER)
    }

    const [
        slot0,
        token0,
        token1,
    ] = await Promise.all([
        exp == 2 ? uniswapPair.callStatic.slot0() : undefined,
        uniswapPair.callStatic.token0(),
        uniswapPair.callStatic.token1(),
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

    const K = settings.power * exp
    const prefix = exp == 2 ? '√' : ''

    console.log(
        'INDEX',
        QTI == 1 ? `${prefix}${symbol0}/${symbol1}` : `${prefix}${symbol1}/${symbol0}`,
        'x' + K,
    )

    // detect WINDOW
    let logs
    if ((slot0 && !settings.window) || (!slot0 && !settings.windowBlocks)) {
        // get the block a day before
        const now = Math.floor(new Date().getTime() / 1000)
        const EPOCH = 500 * 60
        const anEpochAgo = now - EPOCH
        const blockEpochAgo = await fetch(
            `${configs.scanApi}?module=block&action=getblocknobytime&timestamp=${anEpochAgo}&closest=before&apikey=${SCAN_API_KEY[chainID]}`
        ).then(x => x.json()).then(x => Number(x?.result))

            logs = await fetch(
            `${configs.scanApi}?module=logs&action=getLogs&address=${settings.pairAddress[0]}` +
            `&topic0=${SWAP_TOPIC[slot0 ? 3 : 2]}` +
            `&fromBlock=${blockEpochAgo}&apikey=${SCAN_API_KEY[chainID]}`
        ).then(x => x.json()).then(x => x?.result)

        if (!logs?.length) {
            throw new Error('no transaction for a whole day')
        }
    }

    let WINDOW
    if (slot0) {
        if (logs?.length > 0) {
            const txFreq = EPOCH / logs.length
            WINDOW = Math.ceil(Math.sqrt(txFreq / 60)) * 60
        } else {
            WINDOW = settings.window
        }
        console.log('WINDOW', WINDOW / 60, 'min(s)')
        try {
            await uniswapPair.callStatic.observe([0, WINDOW])
        } catch (err) {
            if (err.reason == 'OLD') {
                throw new Error('WINDOW too long')
            }
            throw err
        }
    } else {
        if (logs?.length > 0) {
            const range = logs[logs.length - 1].blockNumber - logs[0].blockNumber + 1
            const txFreq = range / logs.length
            WINDOW = Math.floor(txFreq / 10) * 10
            WINDOW = Math.max(WINDOW, 20)
            WINDOW = Math.min(WINDOW, 256)
        } else {
            WINDOW = settings.windowBlocks
        }
        console.log('WINDOW', WINDOW, 'block(s)')
    }

    const ORACLE = ethers.utils.hexZeroPad(
        bn(QTI).shl(255).add(bn(WINDOW).shl(256 - 64)).add(settings.pairAddress[0]).toHexString(),
        32,
    )
    
    let MARK, price
    if (slot0) {
        MARK = slot0.sqrtPriceX96.shl(32)
        if (QTI == 0) {
            MARK = Q256M.div(MARK)
        }
        price = MARK.mul(MARK)
    } else {
        const [r0, r1] = await uniswapPair.getReserves()
        if (QTI == 0) {
            MARK = r0.mul(Q128).div(r1)
        } else {
            MARK = r1.mul(Q128).div(r0)
        }
        price = MARK
    }
    const decShift = QTI == 0 ? decimals1 - decimals0 : decimals0 - decimals1
    if (decShift > 0) {
        price = price.mul(numberToWei(1, decShift))
    } else if (decShift < 0) {
        price = price.div(numberToWei(1, -decShift))
    }
    console.log('MARK', mulDivNum(price, Q128.pow(exp)))

    const INTEREST_HL = rateToHL(settings.interestRate, settings.power)
    const PREMIUM_HL = rateToHL(settings.premiumRate, settings.power)

    console.log('INTEREST_HL', (INTEREST_HL / SECONDS_PER_DAY).toFixed(2), 'day(s)')
    console.log('PREMIUM_HL', (PREMIUM_HL / SECONDS_PER_DAY).toFixed(2), 'day(s)')

    const config = {
        FETCHER,
        ORACLE,
        TOKEN_R,
        MARK,
        K: bn(K),
        INTEREST_HL,
        PREMIUM_HL,
        MATURITY: settings.closingFeeDuration,
        MATURITY_VEST: settings.vesting,
        MATURITY_RATE: feeToOpenRate(settings.closingFee ?? 0),
        OPEN_RATE: feeToOpenRate(settings.openingFee ?? 0),
    }

    console.log('MATURITY', (config.MATURITY / SECONDS_PER_HOUR).toFixed(2), 'hr(s)')
    console.log('VESTING', (config.MATURITY_VEST / 60).toFixed(2), 'min(s)')
    console.log('CLOSE_FEE', Q128.sub(config.MATURITY_RATE).mul(PRECISION*100).shr(128).toNumber() / PRECISION, '%')
    console.log('OPEN_FEE', Q128.sub(config.OPEN_RATE).mul(PRECISION*100).shr(128).toNumber() / PRECISION, '%')

    // Create Pool
    const poolFactory = await ethers.getContractAt("contracts/PoolFactory.sol:PoolFactory", configs.derivable.poolFactory, deployer)

    // init the pool
    const R = ethers.utils.parseEther(String(settings.R ?? 0.0001))
    const initParams = await calculateInitParamsFromPrice(config, MARK, R)

    const utr = new ethers.Contract(configs.helperContract.utr, require("@derivable/utr/build/UniversalTokenRouter.json").abi, deployer)
    const helper = await ethers.getContractAt("contracts/support/Helper.sol:Helper", configs.derivable.helper ?? configs.derivable.stateCalHelper, deployer)

    // get pool address
    const poolAddress = await poolFactory.callStatic.createPool(config)
    const pool = await ethers.getContractAt("PoolBase", poolAddress)

    console.log('New Pool Address:', poolAddress)

    let params

    if (TOKEN_R != configs.wrappedTokenAddress) {
        const rERC20 = new ethers.Contract(TOKEN_R, require("@uniswap/v2-core/build/ERC20.json").abi, deployer)
        const rAllowance = await rERC20.allowance(deployer.address, utr.address)
        if (rAllowance.lt(R)) {
            throw new Error("!!! Token reserve approval required !!!")
        }
        const payment = {
            utr: utr.address,
            payer: deployer.address,
            recipient: deployer.address,
        }
        params = [
            [],
            [
                {
                    inputs: [],
                    code: poolFactory.address,
                    data: (await poolFactory.populateTransaction.createPool(
                        config
                    )).data,
                },
                {
                    inputs: [{
                        mode: PAYMENT,
                        eip: 20,
                        token: TOKEN_R,
                        id: 0,
                        amountIn: R,
                        recipient: pool.address,
                    }],
                    code: poolAddress,
                    data: (await pool.populateTransaction.init(
                        initParams,
                        payment,
                    )).data,
                }
            ],
            { gasPrice },
        ]
    } else {
        params = [
            config,
            initParams,
            configs.derivable.poolFactory,
            { value: R, gasPrice },
        ]
    }

    const gasUsed = TOKEN_R != configs.wrappedTokenAddress
        ? await utr.estimateGas.exec(...params)
        : await helper.estimateGas.createPool(...params)

    console.log('Estimated Gas:', gasUsed.toNumber().toLocaleString())

    params[params.length-1].gasLimit = gasUsed.mul(3).div(2)

    console.log(`> Enter [Y] to deploy, [Ctrl-C] to stop.`);

    await waitForKey(89)

    console.log('Sending tx...')

    try {
        const tx = TOKEN_R != configs.wrappedTokenAddress
            ? await utr.exec(...params)
            : await helper.createPool(...params)
        
        console.log('Waiting for tx receipt...', tx.hash)

        const rec = await tx.wait()
        console.log('Gas Used:', rec.gasUsed.toNumber())
        console.log('Logs:', rec.logs)
    } catch (err) {
        console.error(err.reason ?? err.error ?? err)
    }
}

function waitForKey(keyCode = 10) {
    return new Promise(resolve => {
        process.stdin.on('data', function (chunk) {
            if (chunk[0] === keyCode) {
                resolve();
                process.stdin.pause();
            }
        });
    });
}

function mulDivNum(a, b, precision = 4) {
    const al = a.toString().length
    const bl = b.toString().length
    const d = al - bl
    if (d > 0) {
        b = b.mul(numberToWei(1, d))
    } else if (d < 0) {
        a = a.mul(numberToWei(1, -d))
    }
    a = a.mul(numberToWei(1, precision))
    let c = a.div(b)
    c = Math.round(c)
    return mdp(c, d - precision)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy(settings).catch((error) => {
    console.error(error)
    process.exitCode = 1
})
