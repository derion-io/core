const ethers = require('ethers')
const { AddressZero } = require("@ethersproject/constants");
const { SIDE_A, SIDE_B, Q128 } = require('./constant');
const abiCoder = new ethers.utils.AbiCoder()

module.exports = class Pool {
  constructor(
    contract,
    config,
    utilContracts
  ) {
    this.contract = contract
    this.config = config
    this.utilContracts = utilContracts
  }

  connect(account) {
    return new Pool(
      this.contract.connect(account),
      this.config,
      this.utilContracts
    )
  }

  async swap(
    sideIn,
    sideOut,
    amount,
    maturity,
    options = {
      swapType: 0,
      payer: AddressZero,
      recipient: this.contract.signer.address
    }
  ) {
    if (sideOut == SIDE_A || sideOut == SIDE_B) {
      amount = amount.mul(this.config.openRate).div(Q128) // apply open rate
    }
    const payload = abiCoder.encode(
      ["uint", "uint", "uint", "uint", "uint", "tuple(uint, uint, uint, uint)"],
      [
        options.swapType, 
        sideIn, 
        sideOut, 
        amount, 
        maturity, 
        [ this.config.premiumRate, this.config.discountRate, this.config.maturity, this.config.halfLife]
      ]
    )
    return await this.contract.swap(
      {
        sideIn,
        sideOut,
        maturity,
        helper: this.utilContracts.helper.address,
        payload
      },
      {
        utr: this.utilContracts.utr.address,
        payer: options.payer,
        recipient: options.recipient
      }
    )
  }
}

