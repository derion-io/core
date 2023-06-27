const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { attemptSwap, numberToWei, paramToConfig, bn, swapToSetPriceMock, weiToNumber, encodePayload, feeToOpenRate, packId } = require("./shared/utilities")
const { SIDE_R, SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant")
const { AddressZero, MaxUint256 } = require("@ethersproject/constants");
const { _selectPrice, _evaluate } = require("./shared/AsymptoticPerpetual")
const { expect } = require("chai")

describe('Input', function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        openRate: feeToOpenRate(0.003),
        premiumRate: bn(1).shl(128).div(2)
    }])

    async function swapExpectInput(sideIn, sideOut, amount) {
        const { utr, derivablePools, owner, weth, derivable1155, stateCalHelper } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const balanceBefore = (sideIn == SIDE_R) 
            ? await weth.balanceOf(owner.address)
            : await derivable1155.balanceOf(owner.address, packId(sideIn, pool.contract.address))

        await pool.swap(
            sideIn,
            sideOut,
            numberToWei(amount),
            0
        )

        const balanceAfter = (sideIn == SIDE_R) 
            ? await weth.balanceOf(owner.address)
            : await derivable1155.balanceOf(owner.address, packId(sideIn, pool.contract.address))

        expect(Number(weiToNumber(balanceBefore.sub(balanceAfter)))).to.be.closeTo(amount, 1e-10)
    }

    it('R -> A (No Premium)', async function() {
        await swapExpectInput(SIDE_R, SIDE_A, 0.1)
    })
    it('R -> B (No Premium)', async function() {
        await swapExpectInput(SIDE_R, SIDE_B, 0.1)
    })
    it('R -> C (No Premium)', async function() {
        await swapExpectInput(SIDE_R, SIDE_C, 0.1)
    })
    it('A -> R (No Premium)', async function() {
        await swapExpectInput(SIDE_A, SIDE_R, 0.01)
    })
    it('B -> R (No Premium)', async function() {
        await swapExpectInput(SIDE_B, SIDE_R, 0.01)
    })
    it('C -> R (No Premium)', async function() {
        await swapExpectInput(SIDE_C, SIDE_R, 0.01)
    })
    it('R -> A, rA > 50%, expect wallet loses 1e', async function () {
        const { derivablePools, owner, params, oracleLibrary, usdc, weth, uniswapPair } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const config = paramToConfig(params[0])

        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            0
        )

        await swapToSetPriceMock({
            quoteToken: usdc,
            baseToken: weth,
            uniswapPair,
            targetTwap: 2000,
            targetSpot: 2000
        })
        const state = await pool.contract.getStates()
        const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
        const price = _selectPrice(
            config,
            state,
            { min: oraclePrice.spot, max: oraclePrice.twap },
            0x00,
            0x10,
            bn(await time.latest())
        )
        const eval = _evaluate(price.market, state)

        expect(eval.rA.mul(2)).to.be.gt(state.R) // Check rA > R/2

        const wethBefore = await weth.balanceOf(owner.address)

        await pool.swap(
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            0
        )

        const wethAfter = await weth.balanceOf(owner.address)
        expect(Number(weiToNumber(wethBefore.sub(wethAfter)))).to.be.eq(1)
    })

    it('R -> B, rB > 50%, expect wallet loses 1e', async function () {
        const { derivablePools, owner, params, oracleLibrary, usdc, weth, uniswapPair } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const config = paramToConfig(params[0])

        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(1),
            0
        )

        await swapToSetPriceMock({
            quoteToken: usdc,
            baseToken: weth,
            uniswapPair,
            targetTwap: 1000,
            targetSpot: 1000
        })
        const state = await pool.contract.getStates()
        const oraclePrice = await oracleLibrary.fetch(config.ORACLE)
        const price = _selectPrice(
            config,
            state,
            { min: oraclePrice.spot, max: oraclePrice.twap },
            SIDE_R,
            SIDE_B,
            bn(await time.latest())
        )
        const eval = _evaluate(price.market, state)

        // console.log(eval, state.R)
        expect(eval.rB.mul(2)).to.be.gt(state.R) // Check rB > R/2

        const wethBefore = await weth.balanceOf(owner.address)
        await pool.swap(
            SIDE_R,
            SIDE_B,
            numberToWei(1),
            0
        )
        const wethAfter = await weth.balanceOf(owner.address)
        expect(Number(weiToNumber(wethBefore.sub(wethAfter)))).to.be.eq(1)
    })
})