const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A } = require("./shared/constant")
const { numberToWei, packId } = require("./shared/utilities")
const { expect } = require("chai")
const { AddressZero, MaxUint256 } = ethers.constants;

const maturities = [60, 0]

maturities.forEach(maturity => describe(`Swap and merge maturity: ${maturity}`, function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    maturity
  }])

  it('R -> A, Not yet maturity', async function () {
    const { accountA, accountB, derivablePools, stateCalHelper, weth, utr, derivable1155 } = await loadFixture(fixture)
    const pool = derivablePools[0].connect(accountA)

    const outId = packId(SIDE_A, pool.contract.address)
    await weth.connect(accountA).approve(utr.address, MaxUint256)

    await pool.swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    await time.increase(1)

    const inBalanceBefore = await weth.balanceOf(accountA.address)
    const outBalanceBefore = await derivable1155.balanceOf(accountA.address, outId)
    const expectedAmountOut = await pool.connect(accountB).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0,
      { static: true }
    )

    const txn = await stateCalHelper.connect(accountA).populateTransaction.swap({
      sideIn: SIDE_R,
      poolIn: pool.contract.address,
      sideOut: SIDE_A,
      poolOut: pool.contract.address,
      amountIn: numberToWei(1),
      maturity: 0,
      payer: accountA.address,
      recipient: accountA.address
    })
    const sweepTxn = await stateCalHelper.populateTransaction.sweep(
      outId, accountA.address
    )

    await utr.connect(accountA).exec([], [{
      inputs: [{
        mode: 1,
        eip: 1155,
        token: derivable1155.address,
        id: outId,
        amountIn: outBalanceBefore,
        recipient: stateCalHelper.address,
      }],
      code: AddressZero,
      data: []
    }, 
    {
      inputs: [{
        mode: 0,
        eip: 20,
        token: weth.address,
        id: 0,
        amountIn: numberToWei(1),
        recipient: derivablePools[0].contract.address,
      }],
      code: stateCalHelper.address,
      data: txn.data,
    }, {
      inputs: [{
        mode: 2,
        eip: 20,
        token: weth.address,
        id: 0,
        amountIn: 0,
        recipient: accountA.address,
      }],
      code: stateCalHelper.address,
      data: sweepTxn.data,
    }
  ])

    const inBalanceAfter = await weth.balanceOf(accountA.address)
    const outBalanceAfter = await derivable1155.balanceOf(accountA.address, outId)

    expect(numberToWei(1).sub(inBalanceBefore.sub(inBalanceAfter))).lte(10)
    expect(outBalanceAfter.sub(outBalanceBefore)).eq(expectedAmountOut)
  })

}))