const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A } = require("./shared/constant")
const { numberToWei, packId } = require("./shared/utilities")
const { expect } = require("chai")
const { MaxUint256 } = ethers.constants;

const maturities = [60, 0]

const static = true

const PAYMENT = 0;
const TRANSFER = 1;

maturities.forEach(maturity => describe(`Swap and merge maturity: ${maturity}`, async function () {
  const fixture = await loadFixtureFromParams([{
    ...baseParams,
    maturity,
  }])

  it('R -> A, Not yet maturity', async function () {
    const { accountA, accountB, derivablePools, stateCalHelper, weth, utr, derivable1155 } = await loadFixture(fixture)
    const pool = derivablePools[0].connect(accountA)

    const idOut = packId(SIDE_A, pool.contract.address)
    await weth.connect(accountA).approve(utr.address, MaxUint256)

    const amountIn = numberToWei(1)

    await pool.swap(
      SIDE_R,
      SIDE_A,
      amountIn,
    )

    if (maturity > 0) {
      await expect(pool.connect(accountA).swap(
        SIDE_R,
        SIDE_A,
        amountIn,
      ), 'merge with maturity').revertedWith('MATURITY_ORDER')
    } else {
      const amountOut = await pool.connect(accountA).swap(
        SIDE_R,
        SIDE_A,
        amountIn,
        { static },
      )
      expect(amountOut, 'merge without maturity').gt(0)
    }

    const inBalanceBefore = await weth.balanceOf(accountA.address)
    const currentBalance = await derivable1155.balanceOf(accountA.address, idOut)
    const expectedAmountOut = await pool.connect(accountB).swap(
      SIDE_R,
      SIDE_A,
      amountIn,
      { static },
    )

    const swapTx = await stateCalHelper.connect(accountA).populateTransaction.swap({
      sideIn: SIDE_R,
      poolIn: pool.contract.address,
      sideOut: SIDE_A,
      poolOut: pool.contract.address,
      amountIn,
      payer: accountA.address,
      recipient: accountA.address,
      INDEX_R: 0
    })
    const sweepTx = await stateCalHelper.populateTransaction.sweep(
      idOut, accountA.address
    )

    await utr.connect(accountA).exec([{
      recipient: accountA.address,
      eip: 1155,
      token: derivable1155.address,
      id: idOut,
      amountOutMin: 1,
    }], [{
      inputs: [{
        mode: TRANSFER,
        eip: 1155,
        token: derivable1155.address,
        id: idOut,
        amountIn: currentBalance,
        recipient: stateCalHelper.address,
      }, {
        mode: PAYMENT,
        eip: 20,
        token: weth.address,
        id: 0,
        amountIn,
        recipient: derivablePools[0].contract.address,
      }],
      code: stateCalHelper.address,
      data: swapTx.data,
    }, {
      inputs: [],
      code: stateCalHelper.address,
      data: sweepTx.data,
    }])

    const inBalanceAfter = await weth.balanceOf(accountA.address)
    const outBalanceAfter = await derivable1155.balanceOf(accountA.address, idOut)

    expect(amountIn.sub(inBalanceBefore.sub(inBalanceAfter))).lte(10)
    expect(outBalanceAfter.sub(currentBalance)).eq(expectedAmountOut)
  })

}))