const ethers = require('ethers')
const bnjs = require('bignumber.js')
const { Q128 } = require('./constant')
bnjs.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const abiCoder = new ethers.utils.AbiCoder()

const stringToBytes32 = (text) => {
    let result = hre.ethers.utils.hexlify(hre.ethers.utils.toUtf8Bytes(text))
    while (result.length < 66) { result += '0' }
    if (result.length !== 66) { throw new Error("invalid implicit bytes32") }
    return result
}

const ONE = ethers.BigNumber.from(1)
const TWO = ethers.BigNumber.from(2)

const opts = {
    gasLimit: 30000000
}
const bn = ethers.BigNumber.from
const numberToWei = (number, decimal = 18) => {
    return ethers.utils.parseUnits(number.toString(), decimal)
}

const weiToNumber = (number, decimal = 18) => {
    return ethers.utils.formatUnits(number.toString(), decimal)
}

const calculateSwapToPrice = ({ r0, r1, token0, token1 }, targetPrice, quoteToken) => {
    targetPrice = numberToWei(targetPrice)

    const [rb, rq] = quoteToken === token0 ? [r1, r0] : [r0, r1]
    const oldPrice = rq.mul(numberToWei(1)).div(rb)

    if (targetPrice.gt(oldPrice)) {
        const a = bn(997)
        const b = rq.mul(1000).add(rq.mul(997))
        const c1 = rq.mul(rq).mul(1000)
        const c2 = targetPrice.mul(rq).mul(rb).mul(1000).div(numberToWei(1))

        const { x1, x2 } = quadraticEquation(a, b, c1.sub(c2))
        let amount = x1.isNegative() ? x2 : x1
        let amount1 = bn(1)
        while (1) {
            const price = getPriceAfterSwap(rq, rb, amount.add(amount1))
            if (price.gt(targetPrice)) {
                break
            } else {
                amount1 = amount1.mul(2)
            }
        }

        return {
            amount: amount.add(amount1),
            tokenInput: quoteToken === token0 ? token0 : token1
        }

    } else {
        const a = bn(997)
        const b = rb.mul(997).add(rb.mul(1000))
        const c1 = rb.mul(rb).mul(1000)
        const c2 = rq.mul(rb).mul(1000).mul(numberToWei(1)).div(targetPrice)
        const { x1, x2 } = quadraticEquation(a, b, c1.sub(c2))
        return {
            amount: x1.isNegative() ? x2 : x1,
            tokenInput: quoteToken === token0 ? token1 : token0
        }
    }
}

function getPriceAfterSwap(rI, rO, amountIn, tokenInIsQuote = true) {
    const amountInWithFee = amountIn.mul(997)
    const amountOut = amountInWithFee.mul(rO).div(rI.mul(1000).add(amountInWithFee))
    return tokenInIsQuote ?
        rI.add(amountIn).mul(numberToWei(1)).div(rO.sub(amountOut))
        :
        rO.add(amountOut).mul(numberToWei(1)).div(rI.sub(amountIn))
}

function sqrt(value) {
    const x = ethers.BigNumber.from(value)
    let z = x.add(ONE).div(TWO)
    let y = x
    while (z.sub(y).isNegative()) {
        y = z
        z = x.div(z).add(z).div(TWO)
    }
    return y
}


function quadraticEquation(a, b, c) {
    var x1, x2
    // delta = b^2 - 4ac
    const delta = b.mul(b).sub(bn(4).mul(a).mul(c))
    if (delta.isZero()) {
        x1 = undefined
        x2 = undefined
    } else if (delta.lt(0)) {
        // x1 = x2 = -sqrt(delta) / 2a
        x1 = bn(0).sub(sqrt(delta)).div(a.mul(2))
        x2 = bn(0).sub(sqrt(delta)).div(a.mul(2))
    } else {
        // x1 = (-b - sqrt(delta)) / 2a
        // x2 = (-b + sqrt(delta)) / 2a
        x1 = bn(0).sub(b).add(sqrt(delta)).div(a.mul(2))
        x2 = bn(0).sub(b).sub(sqrt(delta)).div(a.mul(2))
    }
    return { x1, x2 }
}

async function swapToSetPrice({ account, uniswapPool, uniswapRouter, quoteToken, targetPrice }) {
    const [[r0, r1], token0, token1] = await Promise.all([
        uniswapPool.getReserves(),
        uniswapPool.token0(),
        uniswapPool.token1(),
    ])

    const res = calculateSwapToPrice({
        r0,
        r1,
        token0,
        token1
    }, targetPrice, quoteToken)

    const tx = await uniswapRouter.swapExactTokensForTokens(
        res.amount,
        0,
        [res.tokenInput === token0 ? token0 : token1, res.tokenInput === token0 ? token1 : token0],
        account.address,
        new Date().getTime() + 10000,
        { gasLimit: 30000000 },
    )
    await tx.wait(1)
}

const packId = (kind, address) => {
    const k = bn(kind)
    return k.shl(160).add(address)
}

const unpackId = (id) => {
    const k = ethers.utils.hexlify(id.shr(160))
    const p = ethers.utils.getAddress(ethers.utils.hexlify(id.mod(bn(1).shl(160))))
    return { k, p }
}

function encodeSqrtX96(reserve1, reserve0) {
    return bn((Math.sqrt(reserve1 / reserve0) * 10 ** 12).toFixed(0))
        .mul(bn(2).pow(96))
        .div(10 ** 12)
}

function encodePriceSqrt(reserve1, reserve0) {
    return ethers.BigNumber.from(
      new bnjs(reserve1.toString())
        .div(reserve0.toString())
        .sqrt()
        .multipliedBy(new bnjs(2).pow(96))
        .integerValue(3)
        .toString()
    )
}

function encodePayload(swapType, sideIn, sideOut, amount) {
    return abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [swapType, sideIn, sideOut, amount]
    )
}

async function attemptSwap(signer, swapType, sideIn, sideOut, amount, helper, payer, recipient, timelock = 0) {
    const payload = abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [swapType, sideIn, sideOut, amount]
    )
    return await signer.swap(
        sideIn,
        sideOut,
        helper,
        payload,
        timelock,
        payer,
        recipient
    )
}

async function attemptStaticSwap(signer, swapType, sideIn, sideOut, amount, helper, payer, recipient, timelock = 0) {
    const payload = abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [swapType, sideIn, sideOut, amount]
    )
    return (await signer.callStatic.swap(
        sideIn,
        sideOut,
        helper,
        payload,
        timelock,
        payer,
        recipient,
    )).amountOut
}

function decodeDataURI(data) {
    const json = Buffer.from(data.substring(29), "base64").toString()
    return JSON.parse(json)
}

async function swapToSetPriceV3({ account, quoteToken, baseToken, uniswapRouter, initPrice, targetPrice }) {
    const quoteTokenIndex = baseToken.address.toLowerCase() < quoteToken.address.toLowerCase() ? 1 : 0
    const priceX96 = encodeSqrtX96(quoteTokenIndex ? targetPrice : 1, quoteTokenIndex ? 1 : targetPrice)
    const tx = await uniswapRouter.connect(account).exactInputSingle({
        payer: account.address,
        tokenIn: (initPrice < targetPrice) ? quoteToken.address : baseToken.address,
        tokenOut: (initPrice < targetPrice) ? baseToken.address : quoteToken.address,
        fee: 500,
        sqrtPriceLimitX96: priceX96,
        recipient: account.address,
        deadline: new Date().getTime() + 100000,
        amountIn: numberToWei("1000000000000000000"),
        amountOutMinimum: 0,
    }, opts)
    await tx.wait(1)
}

async function swapToSetPriceMock({ quoteToken, baseToken, uniswapPair, targetTwap, targetSpot }) {
    const quoteTokenIndex = baseToken.address.toLowerCase() < quoteToken.address.toLowerCase() ? 1 : 0
    const priceTwapX96 = encodeSqrtX96(quoteTokenIndex ? targetTwap : 1, quoteTokenIndex ? 1 : targetTwap)
    const priceSpotX96 = encodeSqrtX96(quoteTokenIndex ? targetSpot : 1, quoteTokenIndex ? 1 : targetSpot)
    await uniswapPair.setPrice(priceSpotX96, priceTwapX96)
}

function feeToOpenRate(fee) {
    return bn(((1-fee)*10000).toFixed(0)).mul(Q128).div(10000)
}

function paramToConfig(param) {
    return {
        TOKEN: param.token,
        TOKEN_R: param.reserveToken,
        ORACLE: param.oracle,
        K: param.k,
        MARK: param.mark,
        INIT_TIME: param.initTime,
        HALF_LIFE: bn(param.halfLife),
        PREMIUM_RATE: bn(param.premiumRate)
    }
}


module.exports = {
    stringToBytes32,
    calculateSwapToPrice,
    weiToNumber,
    numberToWei,
    bn,
    swapToSetPrice,
    packId,
    unpackId,
    encodeSqrtX96,
    encodePriceSqrt,
    encodePayload,
    attemptSwap,
    attemptStaticSwap,
    decodeDataURI,
    swapToSetPriceV3,
    feeToOpenRate,
    paramToConfig,
    swapToSetPriceMock
}
