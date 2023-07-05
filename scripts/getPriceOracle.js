const { ethers } = require('ethers')
// IMPORTS AND SETUP

const JSBI = require('jsbi') // jsbi@3.2.5
const { abi: IUniswapV3PoolABI } = require("./compiled/UniswapV3Pool.json");
const { TickMath } = require('@uniswap/v3-sdk')

require('dotenv').config()

const POOL_ADDRESS = '0x12B2483ADd89741e89C25F2E1C798F9fe8EF7664'

const provider = new ethers.providers.JsonRpcProvider(hre.network.config.url)
const poolContract = new ethers.Contract(
  POOL_ADDRESS,
  IUniswapV3PoolABI,
  provider
)

async function main(hre, pool, seconds) {
  const secondsAgo = [seconds, 0]

  const observeData = await pool.observe(secondsAgo)
  const tickCumulatives = observeData.tickCumulatives.map(v => Number(v))

  const tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0]

  const arithmeticMeanTick = (tickCumulativesDelta / secondsAgo[0]).toFixed(0)

  const arithmeticMeanTickInt = parseInt(arithmeticMeanTick)
  const sqrtRatioX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTickInt)

  const max = JSBI.BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935")
  const twap = JSBI.leftShift(sqrtRatioX96, JSBI.BigInt(32))
  console.log(JSBI.divide(max, twap).toString())
}

main(hre, poolContract, 100)