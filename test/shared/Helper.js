const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { ZERO, Q128, Q64, Q256M, SIDE_A, SIDE_B, SIDE_C, SIDE_R } = require("./constant");
const { mulDivRoundingUp } = require("./FullMath");
const { packId } = require("./utilities");
const bn = ethers.BigNumber.from

const abiCoder = new ethers.utils.AbiCoder()

const numberToWei = (number, decimal = 18) => {
  return ethers.utils.parseUnits(number.toString(), decimal)
}

const weiToNumber = (number, decimal = 18) => {
  return ethers.utils.formatUnits(number.toString(), decimal)
}


function _v(xk, r, R) {
  if (R.shr(1).gte(r)) {
    return mulDivRoundingUp(r, Q128, xk)
  }
  const denominator = R.sub(r).mul(xk.shl(2)).div(Q128)
  return mulDivRoundingUp(R, R, denominator)
}

async function swapToState(
  market, // {xkA, xkB}
  state, // {a, b, R}
  rA,
  rB,
  payload,
  derivable1155,
  pool
) {
  let [sideIn, sideOut, amount] = abiCoder.decode(["uint", "uint", "uint"], payload)
  const state1 = {...state}
  let rA1 = rA
  let rB1 = rB
  if (sideIn.eq(SIDE_R)) {
    state1.R = state1.R.add(amount)
    if (sideOut.eq(SIDE_A)) {
      rA1 = rA1.add(amount)
    } else if (sideOut.eq(SIDE_B)) {
      rB1 = rB1.add(amount)
    }
  } else {
    const s = await derivable1155.totalSupply(packId(pool.address, sideIn))
    if (sideIn.eq(SIDE_A)) {
      amount = amount.mul(rA).div(s)
      rA1 = rA1.sub(amount)
    } else if (sideIn.eq(SIDE_B)) {
      amount = amount.mul(rB).div(s)
      rB1 = rB1.sub(amount)
    } else if (sideIn.eq(SIDE_C)) {
      amount = amount.sub(1)
      const rC = state.R.sub(rA).sub(rB)
      amount = amount.mul(rC).div(s)
    }
    state1.R = state1.R.sub(amount)
  }
  state1.a = _v(market.xkA, rA1, state1.R)
  state1.b = _v(market.xkB, rB1, state1.R)
  return state1
}

module.exports = {
  _v,
  swapToState
}