const ethers = require("ethers");
const bn = ethers.BigNumber.from

const ZERO = bn(0)
const Q64 = bn(1).shl(64)
const Q128 = bn(1).shl(128)
const Q256M = bn('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

module.exports = {
  ZERO,
  Q64,
  Q128,
  Q256M,
  SIDE_A,
  SIDE_B,
  SIDE_C,
  SIDE_R
}