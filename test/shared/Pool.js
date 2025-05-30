const ethers = require('ethers')
const { SIDE_A, SIDE_B, Q128 } = require('./constant');
const { bn } = require("./utilities")
const abiCoder = new ethers.utils.AbiCoder()

const abiPoolLogic = require("../abi/PoolLogic.abi.json")

module.exports = class Pool {
  constructor(
    contract,
    config,
    utilContracts
  ) {
    this.contract = contract
    // override the returns type with custom json abi
    this.contractForTransition = new ethers.Contract(
      contract.address,
      abiPoolLogic,
      contract.signer,
    )
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
    options = {}
  ) {
    const contract = this.contractForTransition
    const swapParams = this.getSwapParam(sideIn, sideOut, amount, options)
    const paymentParams = {
      utr: options.utr || this.utilContracts.utr.address,
      payer: options.payer || [],
      recipient: options.recipient || contract.signer.address
    }
    if (options.static) {
      if (options.keepBoth)
        return (await contract.callStatic.transition(swapParams, paymentParams))
      return (await contract.callStatic.transition(swapParams, paymentParams)).amountOut
    }
    if (options.populateTransaction)
      return await contract.populateTransaction.transition(swapParams, paymentParams)
    return await contract.transition(swapParams, paymentParams)
  }

  getSwapParam(sideIn, sideOut, amount, options={}) {
    if (sideOut == SIDE_A || sideOut == SIDE_B) {
      amount = bn(amount).mul(this.config.openRate).div(Q128) // apply open rate
    }
    const payload = abiCoder.encode(
      ["uint", "uint", "uint"],
      [
        sideIn, 
        sideOut, 
        amount
      ]
    )
    return {
      sideIn,
      sideOut,
      helper: options.helper || this.utilContracts.helper.address,
      payload
    }
  }
}

