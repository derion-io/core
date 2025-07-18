const ethers = require("ethers");
const { feeToOpenRate, numberToWei } = require("./utilities");
const bn = ethers.BigNumber.from
const { AddressZero } = ethers.constants

const baseParams = {
    fetcher: AddressZero,
    mark: bn(38).shl(128),
    k: bn(5),
    a: numberToWei(1),
    b: numberToWei(1),
    halfLife: bn(0),
    premiumHL: bn(0),
    maturity: 0,
    maturityVest: 0,
    maturityRate: 0,
    discountRate: 0,
    openRate: feeToOpenRate(0)
}

module.exports = {baseParams}