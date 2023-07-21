const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { SIDE_R, SIDE_A } = require("./shared/constant")
const { numberToWei, packId, weiToNumber } = require("./shared/utilities")
const { expect } = require("chai")
const { AddressZero, MaxUint256 } = ethers.constants;

const maturities = [60, 0]

maturities.forEach(maturity => describe(`Swap and merge maturity: ${maturity}`, function () {
  const fixture = loadFixtureFromParams([{
    ...baseParams,
    maturity
  }])

  it('R -> A', async function () {
    const {accountA, derivablePools, stateCalHelper, weth, utr, derivable1155} = await loadFixture(fixture)
    const pool = derivablePools[0].connect(accountA)
    const outId = packId(SIDE_A, pool.contract.address)
    await weth.connect(accountA).approve(stateCalHelper.address, MaxUint256)
    const param = await pool.getSwapParam(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    const inBalanceBefore = await weth.balanceOf(accountA.address)
    const outBalanceBefore = await derivable1155.balanceOf(accountA.address, outId)
    const expectedAmountOut = await pool.swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0,
      { static: true }
    )

    await stateCalHelper.connect(accountA).swapAndMerge(
      param,
      {
        utr: utr.address,
        payer: AddressZero,
        recipient: accountA.address
      },
      pool.contract.address
    )

    const inBalanceAfter = await weth.balanceOf(accountA.address)
    const outBalanceAfter = await derivable1155.balanceOf(accountA.address, outId)

    expect(numberToWei(1).sub(inBalanceBefore.sub(inBalanceAfter))).lte(10)
    expect(outBalanceAfter.sub(outBalanceBefore)).eq(expectedAmountOut)
  })

  it('R -> A, Not yet maturity', async function () {
    const {accountA, accountB, derivablePools, stateCalHelper, weth, utr, derivable1155} = await loadFixture(fixture)
    const pool = derivablePools[0].connect(accountA)
    const outId = packId(SIDE_A, pool.contract.address)
    await weth.connect(accountA).approve(stateCalHelper.address, MaxUint256)
    await derivable1155.connect(accountA).setApprovalForAll(stateCalHelper.address, true)
    await pool.swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    await time.increase(1)

    const param = await pool.getSwapParam(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    const inBalanceBefore = await weth.balanceOf(accountA.address)
    const outBalanceBefore = await derivable1155.balanceOf(accountA.address, outId)
    const expectedAmountOut = await pool.connect(accountB).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0,
      { static: true }
    )

    await stateCalHelper.connect(accountA).swapAndMerge(
      param,
      {
        utr: utr.address,
        payer: AddressZero,
        recipient: accountA.address
      },
      pool.contract.address
    )

    const inBalanceAfter = await weth.balanceOf(accountA.address)
    const outBalanceAfter = await derivable1155.balanceOf(accountA.address, outId)

    expect(numberToWei(1).sub(inBalanceBefore.sub(inBalanceAfter))).lte(10)
    expect(outBalanceAfter.sub(outBalanceBefore)).eq(expectedAmountOut)
  })


  it('A -> R', async function () {
    const {accountA, derivablePools, stateCalHelper, weth, utr, derivable1155} = await loadFixture(fixture)
    const pool = derivablePools[0].connect(accountA)
    const inId = packId(SIDE_A, pool.contract.address)
    await derivable1155.connect(accountA).setApprovalForAll(stateCalHelper.address, true)

    await pool.swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )

    await time.increase(maturity + 1)

    const param = await pool.getSwapParam(
      SIDE_A,
      SIDE_R,
      numberToWei(0.1),
      0
    )

    const inBalanceBefore = await derivable1155.balanceOf(accountA.address, inId) 
    const outBalanceBefore = await weth.balanceOf(accountA.address)
    const expectedAmountOut = await pool.swap(
      SIDE_A,
      SIDE_R,
      numberToWei(0.1),
      0,
      { static: true }
    )

    await stateCalHelper.connect(accountA).swapAndMerge(
      param,
      {
        utr: utr.address,
        payer: AddressZero,
        recipient: accountA.address
      },
      pool.contract.address
    )

    const inBalanceAfter = await derivable1155.balanceOf(accountA.address, inId) 
    const outBalanceAfter = await weth.balanceOf(accountA.address)

    expect(numberToWei(0.1).sub(inBalanceBefore.sub(inBalanceAfter))).lte(10)
    expect(outBalanceAfter.sub(outBalanceBefore)).eq(expectedAmountOut)
  })

  it('R -> A, UTR', async function () {
    const {accountA, accountB, derivablePools, stateCalHelper, weth, utr, derivable1155} = await loadFixture(fixture)
    const pool = derivablePools[0].connect(accountA)
    const outId = packId(SIDE_A, pool.contract.address)
    await weth.connect(accountA).approve(utr.address, MaxUint256)
    const param = await pool.getSwapParam(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0
    )
    const inBalanceBefore = await weth.balanceOf(accountA.address)
    const outBalanceBefore = await derivable1155.balanceOf(accountA.address, outId)
    const expectedAmountOut = await pool.connect(accountB).swap(
      SIDE_R,
      SIDE_A,
      numberToWei(1),
      0,
      { static: true }
    )

    const txn = await stateCalHelper.connect(accountA).populateTransaction.swapAndMerge(
      param,
      {
        utr: utr.address,
        payer: accountA.address,
        recipient: accountA.address
      },
      pool.contract.address
    )
    await utr.connect(accountA).exec([], [{
      inputs: [{
        mode: 0,
        eip: 1155,
        token: derivable1155.address,
        id: outId,
        amountIn: outBalanceBefore,
        recipient: stateCalHelper.address,
      }, {
        mode: 0,
        eip: 20,
        token: weth.address,
        id: 0,
        amountIn: numberToWei(1),
        recipient: stateCalHelper.address,
      }],
      code: stateCalHelper.address,
      data: txn.data,
    }])

    const inBalanceAfter = await weth.balanceOf(accountA.address)
    const outBalanceAfter = await derivable1155.balanceOf(accountA.address, outId)

    expect(numberToWei(1).sub(inBalanceBefore.sub(inBalanceAfter))).lte(10)
    expect(outBalanceAfter.sub(outBalanceBefore)).eq(expectedAmountOut)
  })

  
}))