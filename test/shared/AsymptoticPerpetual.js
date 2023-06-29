const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { ZERO, Q128, Q64, Q256M, SIDE_A, SIDE_B, SIDE_C, SIDE_R } = require("./constant");
const { mulDivRoundingUp } = require("./FullMath");
const { _v } = require("./Helper");
const { packId } = require("./utilities");
const bn = ethers.BigNumber.from

const numberToWei = (number, decimal = 18) => {
  return ethers.utils.parseUnits(number.toString(), decimal)
}

const weiToNumber = (number, decimal = 18) => {
  return ethers.utils.formatUnits(number.toString(), decimal)
}


function exp_2(x) {
  if (x.gt(bn('0x400000000000000000'))) throw new Error('err')

  let result = bn('0x80000000000000000000000000000000')

  if (x.and(bn('0x8000000000000000')).gt(ZERO))
    result = result.mul(bn('0x16A09E667F3BCC908B2FB1366EA957D3E')).shr(128)
  if (x.and(bn('0x4000000000000000')).gt(ZERO))
    result = result.mul(bn('0x1306FE0A31B7152DE8D5A46305C85EDEC')).shr(128)
  if (x.and(bn('0x2000000000000000')).gt(ZERO))
    result = result.mul(bn('0x1172B83C7D517ADCDF7C8C50EB14A791F')).shr(128)
  if (x.and(bn('0x1000000000000000')).gt(ZERO))
    result = result.mul(bn('0x10B5586CF9890F6298B92B71842A98363')).shr(128)
  if (x.and(bn('0x800000000000000')).gt(ZERO))
    result = result.mul(bn('0x1059B0D31585743AE7C548EB68CA417FD')).shr(128)
  if (x.and(bn('0x400000000000000')).gt(ZERO))
    result = result.mul(bn('0x102C9A3E778060EE6F7CACA4F7A29BDE8')).shr(128)
  if (x.and(bn('0x200000000000000')).gt(ZERO))
    result = result.mul(bn('0x10163DA9FB33356D84A66AE336DCDFA3F')).shr(128)
  if (x.and(bn('0x100000000000000')).gt(ZERO))
    result = result.mul(bn('0x100B1AFA5ABCBED6129AB13EC11DC9543')).shr(128)
  if (x.and(bn('0x80000000000000')).gt(ZERO))
    result = result.mul(bn('0x10058C86DA1C09EA1FF19D294CF2F679B')).shr(128)
  if (x.and(bn('0x40000000000000')).gt(ZERO))
    result = result.mul(bn('0x1002C605E2E8CEC506D21BFC89A23A00F')).shr(128)
  if (x.and(bn('0x20000000000000')).gt(ZERO))
    result = result.mul(bn('0x100162F3904051FA128BCA9C55C31E5DF')).shr(128)
  if (x.and(bn('0x10000000000000')).gt(ZERO))
    result = result.mul(bn('0x1000B175EFFDC76BA38E31671CA939725')).shr(128)
  if (x.and(bn('0x8000000000000')).gt(ZERO))
    result = result.mul(bn('0x100058BA01FB9F96D6CACD4B180917C3D')).shr(128)
  if (x.and(bn('0x4000000000000')).gt(ZERO))
    result = result.mul(bn('0x10002C5CC37DA9491D0985C348C68E7B3')).shr(128)
  if (x.and(bn('0x2000000000000')).gt(ZERO))
    result = result.mul(bn('0x1000162E525EE054754457D5995292026')).shr(128)
  if (x.and(bn('0x1000000000000')).gt(ZERO))
    result = result.mul(bn('0x10000B17255775C040618BF4A4ADE83FC')).shr(128)
  if (x.and(bn('0x800000000000')).gt(ZERO))
    result = result.mul(bn('0x1000058B91B5BC9AE2EED81E9B7D4CFAB')).shr(128)
  if (x.and(bn('0x400000000000')).gt(ZERO))
    result = result.mul(bn('0x100002C5C89D5EC6CA4D7C8ACC017B7C9')).shr(128)
  if (x.and(bn('0x200000000000')).gt(ZERO))
    result = result.mul(bn('0x10000162E43F4F831060E02D839A9D16D')).shr(128)
  if (x.and(bn('0x100000000000')).gt(ZERO))
    result = result.mul(bn('0x100000B1721BCFC99D9F890EA06911763')).shr(128)
  if (x.and(bn('0x80000000000')).gt(ZERO))
    result = result.mul(bn('0x10000058B90CF1E6D97F9CA14DBCC1628')).shr(128)
  if (x.and(bn('0x40000000000')).gt(ZERO))
    result = result.mul(bn('0x1000002C5C863B73F016468F6BAC5CA2B')).shr(128)
  if (x.and(bn('0x20000000000')).gt(ZERO))
    result = result.mul(bn('0x100000162E430E5A18F6119E3C02282A5')).shr(128)
  if (x.and(bn('0x10000000000')).gt(ZERO))
    result = result.mul(bn('0x1000000B1721835514B86E6D96EFD1BFE')).shr(128)
  if (x.and(bn('0x8000000000')).gt(ZERO))
    result = result.mul(bn('0x100000058B90C0B48C6BE5DF846C5B2EF')).shr(128)
  if (x.and(bn('0x4000000000')).gt(ZERO))
    result = result.mul(bn('0x10000002C5C8601CC6B9E94213C72737A')).shr(128)
  if (x.and(bn('0x2000000000')).gt(ZERO))
    result = result.mul(bn('0x1000000162E42FFF037DF38AA2B219F06')).shr(128)
  if (x.and(bn('0x1000000000')).gt(ZERO))
    result = result.mul(bn('0x10000000B17217FBA9C739AA5819F44F9')).shr(128)
  if (x.and(bn('0x800000000')).gt(ZERO))
    result = result.mul(bn('0x1000000058B90BFCDEE5ACD3C1CEDC823')).shr(128)
  if (x.and(bn('0x400000000')).gt(ZERO))
    result = result.mul(bn('0x100000002C5C85FE31F35A6A30DA1BE50')).shr(128)
  if (x.and(bn('0x200000000')).gt(ZERO))
    result = result.mul(bn('0x10000000162E42FF0999CE3541B9FFFCF')).shr(128)
  if (x.and(bn('0x100000000')).gt(ZERO))
    result = result.mul(bn('0x100000000B17217F80F4EF5AADDA45554')).shr(128)
  if (x.and(bn('0x80000000')).gt(ZERO))
    result = result.mul(bn('0x10000000058B90BFBF8479BD5A81B51AD')).shr(128)
  if (x.and(bn('0x40000000')).gt(ZERO))
    result = result.mul(bn('0x1000000002C5C85FDF84BD62AE30A74CC')).shr(128)
  if (x.and(bn('0x20000000')).gt(ZERO))
    result = result.mul(bn('0x100000000162E42FEFB2FED257559BDAA')).shr(128)
  if (x.and(bn('0x10000000')).gt(ZERO))
    result = result.mul(bn('0x1000000000B17217F7D5A7716BBA4A9AE')).shr(128)
  if (x.and(bn('0x8000000')).gt(ZERO))
    result = result.mul(bn('0x100000000058B90BFBE9DDBAC5E109CCE')).shr(128)
  if (x.and(bn('0x4000000')).gt(ZERO))
    result = result.mul(bn('0x10000000002C5C85FDF4B15DE6F17EB0D')).shr(128)
  if (x.and(bn('0x2000000')).gt(ZERO))
    result = result.mul(bn('0x1000000000162E42FEFA494F1478FDE05')).shr(128)
  if (x.and(bn('0x1000000')).gt(ZERO))
    result = result.mul(bn('0x10000000000B17217F7D20CF927C8E94C')).shr(128)
  if (x.and(bn('0x800000')).gt(ZERO))
    result = result.mul(bn('0x1000000000058B90BFBE8F71CB4E4B33D')).shr(128)
  if (x.and(bn('0x400000')).gt(ZERO))
    result = result.mul(bn('0x100000000002C5C85FDF477B662B26945')).shr(128)
  if (x.and(bn('0x200000')).gt(ZERO))
    result = result.mul(bn('0x10000000000162E42FEFA3AE53369388C')).shr(128)
  if (x.and(bn('0x100000')).gt(ZERO))
    result = result.mul(bn('0x100000000000B17217F7D1D351A389D40')).shr(128)
  if (x.and(bn('0x80000')).gt(ZERO))
    result = result.mul(bn('0x10000000000058B90BFBE8E8B2D3D4EDE')).shr(128)
  if (x.and(bn('0x40000')).gt(ZERO))
    result = result.mul(bn('0x1000000000002C5C85FDF4741BEA6E77E')).shr(128)
  if (x.and(bn('0x20000')).gt(ZERO))
    result = result.mul(bn('0x100000000000162E42FEFA39FE95583C2')).shr(128)
  if (x.and(bn('0x10000')).gt(ZERO))
    result = result.mul(bn('0x1000000000000B17217F7D1CFB72B45E1')).shr(128)
  if (x.and(bn('0x8000')).gt(ZERO))
    result = result.mul(bn('0x100000000000058B90BFBE8E7CC35C3F0')).shr(128)
  if (x.and(bn('0x4000')).gt(ZERO))
    result = result.mul(bn('0x10000000000002C5C85FDF473E242EA38')).shr(128)
  if (x.and(bn('0x2000')).gt(ZERO))
    result = result.mul(bn('0x1000000000000162E42FEFA39F02B772C')).shr(128)
  if (x.and(bn('0x1000')).gt(ZERO))
    result = result.mul(bn('0x10000000000000B17217F7D1CF7D83C1A')).shr(128)
  if (x.and(bn('0x800')).gt(ZERO))
    result = result.mul(bn('0x1000000000000058B90BFBE8E7BDCBE2E')).shr(128)
  if (x.and(bn('0x400')).gt(ZERO))
    result = result.mul(bn('0x100000000000002C5C85FDF473DEA871F')).shr(128)
  if (x.and(bn('0x200')).gt(ZERO))
    result = result.mul(bn('0x10000000000000162E42FEFA39EF44D91')).shr(128)
  if (x.and(bn('0x100')).gt(ZERO))
    result = result.mul(bn('0x100000000000000B17217F7D1CF79E949')).shr(128)
  if (x.and(bn('0x80')).gt(ZERO))
    result = result.mul(bn('0x10000000000000058B90BFBE8E7BCE544')).shr(128)
  if (x.and(bn('0x40')).gt(ZERO))
    result = result.mul(bn('0x1000000000000002C5C85FDF473DE6ECA')).shr(128)
  if (x.and(bn('0x20')).gt(ZERO))
    result = result.mul(bn('0x100000000000000162E42FEFA39EF366F')).shr(128)
  if (x.and(bn('0x10')).gt(ZERO))
    result = result.mul(bn('0x1000000000000000B17217F7D1CF79AFA')).shr(128)
  if (x.and(bn('0x8')).gt(ZERO))
    result = result.mul(bn('0x100000000000000058B90BFBE8E7BCD6D')).shr(128)
  if (x.and(bn('0x4')).gt(ZERO))
    result = result.mul(bn('0x10000000000000002C5C85FDF473DE6B2')).shr(128)
  if (x.and(bn('0x2')).gt(ZERO))
    result = result.mul(bn('0x1000000000000000162E42FEFA39EF358')).shr(128)
  if (x.and(bn('0x1')).gt(ZERO))
    result = result.mul(bn('0x10000000000000000B17217F7D1CF79AB')).shr(128)
  
  return result.shr(bn(63).sub(x.shr(64)).toNumber())
}

function _decayRate(elapsed, hl) {
  if (hl.eq(ZERO)) {
    return Q64
  }
  return exp_2(elapsed.shl(64).div(hl))
}

function _powu(x, y) {
  let z = y.and(1).gt(0) ? x : Q128
  let x1 = x;
  for (let y1 = y.shr(1); y1.gt(0); y1 = y1.shr(1)) {
    x1 = x1.mul(x1).div(Q128)
    if (y1.and(1).gt(0)) {
      z = z.mul(x1).div(Q128)
    }
  }
  return z
}


function _market(K, MARK, decayRateX64, price) {
  let xkA = _powu(price.mul(Q128).div(MARK), K)
  const xkB = Q256M.div(xkA).mul(Q64).div(decayRateX64)
  xkA = xkA.mul(Q64).div(decayRateX64)
  return {xkA, xkB}
}

function _r(xk, v, R) {
  let r = v.mul(xk).div(Q128)
  if (r.gt(R.shr(1))) {
    const denominator = v.mul(xk.shl(2)).div(Q128)
    const minuend = R.mul(R).div(denominator)
    r = R.sub(minuend)
  }
  return r
}

function _evaluate(market, state) {
  const rA = _r(market.xkA, state.a, state.R)
  const rB = _r(market.xkB, state.b, state.R)
  return {rA, rB}
}

function _selectPrice(
  config, //{INIT_TIME, HALF_LIFE, K, MARK}
  state, //{a, b, R}
  prices, //{min, max}
  sideIn,
  sideOut,
  blockTimestamp
) {
  const decayRatex64 = _decayRate(blockTimestamp.sub(config.INIT_TIME), config.HALF_LIFE)
  let {min, max} = prices
  if (min.gt(max)) {
    const temp = min
    min = max
    max = temp
  }
  if (sideOut == SIDE_A || sideIn == SIDE_B) {
    const market = _market(config.K, config.MARK, decayRatex64, max)
    const {rA, rB} = _evaluate(market, state)
    return {rA, rB, market}
  } else if (sideOut == SIDE_B || sideIn == SIDE_A) {
    const market = _market(config.K, config.MARK, decayRatex64, min)
    const {rA, rB} = _evaluate(market, state)
    return {rA, rB, market}
  } else {
    let market = _market(config.K, config.MARK, decayRatex64, min)
    let {rA, rB} = _evaluate(market, state)
    if ((sideIn == SIDE_R) == rB.gt(rA)) {
      market = _market(config.K, config.MARK, decayRatex64, max)
      const eval = _evaluate(market, state)
      rA = eval.rA
      rB = eval.rB
    }
    return {rA, rB, market}
  }
}

async function _init(oracleLibrary, R, params) {
  const oraclePrice = await oracleLibrary.fetch(params.oracle)
  const twap = oraclePrice.twap
  const t = bn(0)
  const decayRateX64 = _decayRate(t, params.halfLife)
  const state = {a: params.a, b: params.b, R}
  const market = _market(params.k, params.mark, decayRateX64, twap)
  // TODO: find (a,b) so rA = rB = R/3
  // const a = _v(market.xkA, R.div(3), R)
  // const b = _v(market.xkB, R.div(3), R)
  return params
}

async function calculateInitParams(config, oracleLibrary, R) {
  const { twap } = await oracleLibrary.fetch(config.ORACLE)
  const market = _market(config.K, config.MARK, Q64, twap)
  const a = _v(market.xkA, R.div(3), R)
  const b = _v(market.xkB, R.div(3), R)
  return {R, a, b}
}

async function _swap(
  sideIn, 
  sideOut,
  derivable1155,
  pool,
  state,
  state1,
  price
) {
  let amountIn
  let amountOut
  const {rA, rB, market} = price
  const evalData = _evaluate(market, state1)
  const rA1 = evalData.rA
  const rB1 = evalData.rB
  if (sideIn == SIDE_R) {
    amountIn = state1.R.sub(state.R)
  } else {
    const s = await derivable1155.totalSupply(packId(sideOut, pool.address))
    if (sideIn == SIDE_A) {
      amountIn = mulDivRoundingUp(s, rA.sub(rA1), rA)
    } else {
      if (sideIn == SIDE_B) {
        amountIn = mulDivRoundingUp(s, rB.sub(rB1), rB)
      } else if (sideIn == SIDE_C) {
        const rC = state.R.sub(rA).sub(rB)
        const rC1 = state1.R.sub(rA1).sub(rB1)
        amountIn = mulDivRoundingUp(s, rC.sub(rC1), rC)
      }
    }
  }
  if (sideOut == SIDE_R) {
    amountOut = state.R.sub(state1.R)
  } else {
    const s = await derivable1155.totalSupply(packId(sideOut, pool.address))
    if (sideOut == SIDE_C) {
      const rC = state.R.sub(rA).sub(rB)
      const rC1 = state1.R.sub(rA1).sub(rB1)
      amountOut = s.mul(rC1.sub(rC)).div(rC)
    } else {
      if (sideOut == SIDE_A) {
        amountOut = s.mul(rA1.sub(rA)).div(rA)
      } else if (sideOut == SIDE_B) {
        amountOut = s.mul(rB1.sub(rB)).div(rB)
      }
    }
  }
  return {amountIn, amountOut}
}

module.exports = {
  _selectPrice,
  _evaluate,
  _init,
  _swap,
  calculateInitParams,
}