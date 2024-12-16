require('dotenv').config()
const mdp = require('move-decimal-point')
const { ethers } = require("hardhat")
const { utils } = ethers
const { AddressZero } = ethers.constants
const { bn, feeToOpenRate, numberToWei } = require("../test/shared/utilities")
const { calculateInitParamsFromPrice } = require("../test/shared/AsymptoticPerpetual")
const { JsonRpcProvider } = require("@ethersproject/providers");
const jsonUniswapV3Pool = require("./compiled/UniswapV3Pool.json")
const jsonUniswapV2Pool = require("@uniswap/v2-core/build/UniswapV2Pair.json")
const jsonERC20 = require("../artifacts/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json")

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

const gasPrices = {
    137: 45e9,
    56: 3e9,
}

const gasPrice = gasPrices[chainID]
const gasLimit = 1000000

const settings = {
    // pairAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443',
    // pairAddress: '0x8d76e9c2bd1adde00a3dcdc315fcb2774cb3d1d6',
    pairAddress: ['0x172fcD41E0913e95784454622d1c3724f546f849'],
    topics: ['BNB', 'BN'],
    // window: 120,
    // windowBlocks: 120,
    power: 8,
    interestRate: 0.03 / 100,
    premiumRate: 3 / 100,
    MATURITY: 60 * 60 * 12,
    vesting: 120,
    closingFeeDuration: 1 * 60 * 60,
    closingFee: 1 / 100,
    // reserveToken: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    // R: 1,
    // reserveToken: 'PLD', // PlayDerivable
    // openingFee: 0/100,
    // R: 0.0003, // init liquidity
}

async function deploy(settings) {
    const configs = await fetch(
        `https://raw.githubusercontent.com/derivable-labs/configs/dev/${chainID}/network.json`
    ).then(res => res.json())

    const provider = new JsonRpcProvider(configs.rpc, chainID)

    const TOKEN_R = settings.reserveToken == 'PLD'
        ? configs.derivable.playToken
        : settings.reserveToken ?? configs.wrappedTokenAddress

    if (!settings.R) {
        settings.R = 0.0003
    }

    const deployer = new ethers.Wallet(process.env.MAINNET_DEPLOYER, provider);

    const rToken = new ethers.Contract(TOKEN_R, jsonERC20.abi, deployer)
    const [rSymbol, rDecimals] = await Promise.all([
        rToken.symbol(),
        rToken.decimals(),
    ])

    console.log('TOKEN_R', rSymbol, settings.R)

    // const balance = await tokenR.balanceOf('0xC80EdE62B650Fd825FA9E0e17E6dc03cdcD30562')
    // console.log(balance)

    // const r = await provider.getTransactionReceipt('0x45fc367f05054bcea17781e852dd767241686a3dd4502dcbb736c6466e0c2147')
    // console.log(r)
    // return

    let uniswapPair = new ethers.Contract(settings.pairAddress[0], jsonUniswapV3Pool.abi, deployer)
    console.log('PAIR', uniswapPair.address)

    const factory = await uniswapPair.callStatic.factory()
    console.log('FACTORY', factory)

    const factoryConfig = configs.factory[factory] ?? configs.factory['0x']
    if (!factoryConfig) {
        throw new Error('no config for factory ' + factory)
    }
    const FETCHER = factoryConfig.fetcher ?? AddressZero
    const fetcherType = factoryConfig.type ?? "uniswap3"
    const exp = fetcherType?.endsWith('3') ? 2 : 1
    if (exp == 1) {
        // use the univ2 abi
        uniswapPair = new ethers.Contract(settings.pairAddress[0], jsonUniswapV2Pool.abi, provider)
    }
    if (FETCHER != AddressZero) {
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

    const [baseToken, baseSymbol] = QTI == 1 ? [token0, symbol0] : [token1, symbol1]
    const topic2 = settings.topics?.[0] ?? baseSymbol.slice(0, -1)
    const topic3 = settings.topics?.[1] ?? baseSymbol.substring(1)
    const topics = [baseToken, baseSymbol, topic2, topic3]
    console.log('TOPICS', ...topics)
    topics.forEach((_,i) => {
        if (i > 0) {
            topics[i] = utils.formatBytes32String(topics[i])
        }
    })

    // detect WINDOW
    let EPOCH = 500 * 60
    let logs
    if ((slot0 && !settings.window) || (!slot0 && !settings.windowBlocks)) {
        // get the block a day before
        const now = Math.floor(new Date().getTime() / 1000)
        const anEpochAgo = now - EPOCH
        const blockEpochAgo = await fetch(
            `${configs.scanApi}?module=block&action=getblocknobytime&timestamp=${anEpochAgo}&closest=before&apikey=${process.env[`SCAN_API_KEY_${chainID}`]}`
        ).then(x => x.json()).then(x => Number(x?.result))

        const topic0 = factoryConfig.topic0 ?? "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"

        const apiQuery = `${configs.scanApi}?module=logs&action=getLogs&address=${settings.pairAddress[0]}` +
            `&topic0=${topic0}` +
            `&fromBlock=${blockEpochAgo}&apikey=${process.env[`SCAN_API_KEY_${chainID}`]}`
        logs = await fetch(apiQuery).then(x => x.json()).then(x => x?.result)

        if (!logs?.length) {
            console.log(apiQuery)
            throw new Error('no transaction for a whole day')
        }
        // update the EPOCH when the query limit is reached
        if (logs.length >= 1000) {
            EPOCH = bn(logs[logs.length-1].timeStamp).toNumber() - bn(logs[0].timeStamp).toNumber()
            console.log('Effective EPOCH:', Math.round(EPOCH / 60), 'min(s)')
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
            if (err.reason != 'OLD') {
                throw err
            }
            // throw new Error('WINDOW too long')
            const newCardinality = Math.round(logs.length * WINDOW * 3 / 2 / EPOCH)
            const estimatedGas = await uniswapPair.estimateGas.increaseObservationCardinalityNext(newCardinality)
            console.log(`Spend ${estimatedGas.toNumber().toLocaleString()} gas to increase pair's cardinality from ${slot0.observationCardinalityNext} to ${newCardinality}?`)
            console.log(`> Enter [Y] to accept, [Ctrl-C] to stop.`);
            await waitForKey(89)
            console.log('Sending tx...')
            const tx = await uniswapPair.increaseObservationCardinalityNext(newCardinality, { gasPrice })
            console.log('Waiting for tx receipt...', tx.hash)
            const rec = await tx.wait()
            console.log('Gas Used:', rec.gasUsed.toNumber())
            console.log('Logs:', rec.logs)
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
        MATURITY: settings.closingFeeDuration ?? 0,
        MATURITY_VEST: settings.vesting ?? 0,
        MATURITY_RATE: feeToOpenRate(settings.closingFee ?? 0),
        OPEN_RATE: feeToOpenRate(settings.openingFee ?? 0),
    }

    console.log('MATURITY', (config.MATURITY / SECONDS_PER_HOUR).toFixed(2), 'hr(s)')
    console.log('VESTING', (config.MATURITY_VEST / 60).toFixed(2), 'min(s)')
    console.log('CLOSE_FEE', Q128.sub(config.MATURITY_RATE).mul(PRECISION*100).shr(128).toNumber() / PRECISION, '%')
    console.log('OPEN_FEE', Q128.sub(config.OPEN_RATE).mul(PRECISION*100).shr(128).toNumber() / PRECISION, '%')

    // Create Pool
    const poolDeployer = await ethers.getContractAt("contracts/support/PoolDeployer.sol:PoolDeployer", configs.derivable.poolDeployer, deployer)

    // get TOKEN_R decimals
    const R = ethers.utils.parseUnits(String(settings.R), rDecimals)

    // init the pool
    const initParams = await calculateInitParamsFromPrice(config, MARK, R)

    const utr = new ethers.Contract(configs.helperContract.utr, require("@derion/utr/build/UniversalTokenRouter.json").abi, deployer)

    // get pool address
    const poolAddress = await poolDeployer.callStatic.create(config)
    const pool = await ethers.getContractAt("PoolBase", poolAddress)

    console.log('New Pool Address:', poolAddress)

    let params

    if (TOKEN_R != configs.wrappedTokenAddress) {
        const rBalance = await rToken.balanceOf(deployer.address)
        if (rBalance.lt(R)) {
            throw new Error(`TOKEN_R balance insufficient: ${rBalance} < ${R}`)
        }
        const rAllowance = await rToken.allowance(deployer.address, utr.address)
        if (rAllowance.lt(R)) {
            // await rToken.approve(utr.address, ethers.constants.MaxUint256, { gasPrice })
            throw new Error(`TOKEN_R approval required for UTR (${utr.address})`)
        }
        const payment = {
            utr: utr.address,
            payer: deployer.address,
            recipient: deployer.address,
        }
        params = [
            [],
            [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 20,
                    token: TOKEN_R,
                    id: 0,
                    amountIn: R,
                    recipient: pool.address,
                }],
                code: poolDeployer.address,
                data: (await poolDeployer.populateTransaction.deploy(
                    config,
                    initParams,
                    payment,
                    ...topics,
                )).data,
            }],
            { gasPrice, gasLimit },
        ]
    } else {
        const payment = {
            utr: AddressZero,
            payer: [],
            recipient: deployer.address,
        }
        params = [
            config,
            initParams,
            payment,
            ...topics,
            { value: R, gasPrice, gasLimit },
        ]
    }

    // provider.setStateOverride({
    //     [poolDeployer.address]: {
    //         code: require("../artifacts/contracts/support/PoolDeployer.sol/PoolDeployer.json").deployedBytecode,
    //     },
    //     [configs.derivable.logic]: {
    //         code: require("../artifacts/contracts/PoolLogic.sol/PoolLogic.json").deployedBytecode,
    //     },
    // })

    try {
        // Arbitrum estimateGas does not report contract revert
        const res = TOKEN_R != configs.wrappedTokenAddress
            ? await utr.callStatic.exec(...params)
            : await poolDeployer.callStatic.deploy(...params)
    } catch (err) {
        console.error('callStatic failed:', err.reason ?? err)
        return
    }

    const gasUsed = TOKEN_R != configs.wrappedTokenAddress
        ? await utr.estimateGas.exec(...params)
        : await poolDeployer.estimateGas.deploy(...params)

    console.log('Estimated Gas:', gasUsed.toNumber().toLocaleString())

    params[params.length-1].gasLimit = gasUsed.mul(3).div(2)

    console.log(`> Enter [Y] to deploy, [Ctrl-C] to stop.`);

    await waitForKey(89)

    console.log('Sending tx...')

    try {
        const tx = TOKEN_R != configs.wrappedTokenAddress
            ? await utr.exec(...params)
            : await poolDeployer.deploy(...params)
        
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
            // TBT: process.stdin.resume();
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
