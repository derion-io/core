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

  /**
  * @param options swap options.
  * @param options.payer Default AddressZero.
  * @param options.recipient Default sender.
  * @param options.static If static = true, the function will return the amountOut when callStatic pool swap.
  */
  async swap(
    sideIn,
    sideOut,
    amount,
    maturity,
    options = {}
  ) {
    const swapParams = this.getSwapParam(sideIn, sideOut, amount, maturity, options)
    const paymentParams = {
      utr: this.utilContracts.utr.address,
      payer: options.payer || AddressZero,
      recipient: options.recipient || this.contract.signer.address
    }
    if (options.static)
      return (await this.contract.callStatic.swap(swapParams, paymentParams)).amountOut
    if (options.populateTransaction)
      return await this.contract.populateTransaction.swap(swapParams, paymentParams)
    return await this.contract.swap(swapParams, paymentParams)
  }

  getSwapParam(sideIn, sideOut, amount, maturity, options={}) {
    if (sideOut == SIDE_A || sideOut == SIDE_B) {
      amount = amount.mul(this.config.openRate).div(Q128) // apply open rate
    }
    const payload = abiCoder.encode(
      ["uint", "uint", "uint", "uint"],
      [
        sideIn, 
        sideOut, 
        amount, 
        this.config.premiumRate,
      ]
    )
    return {
      sideIn,
      sideOut,
      maturity,
      helper: options.helper || this.utilContracts.helper.address,
      payload
    }
  }
}

