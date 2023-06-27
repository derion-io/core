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
            : await derivable1155.balanceOf(owner.address, packId(sideIn, pool.address))
        
        await attemptSwap(
            pool,
            0,
            sideIn,
            sideOut,
            numberToWei(amount),
            0,
            stateCalHelper.address,
            utr.address,
            AddressZero,
            owner.address
        )

        const balanceAfter = (sideIn == SIDE_R) 
            ? await weth.balanceOf(owner.address)
            : await derivable1155.balanceOf(owner.address, packId(sideIn, pool.address))

        expect(Number(weiToNumber(balanceBefore.sub(balanceAfter)))).to.be.closeTo(amount, 1e-10)
    }

    it('R -> A', async function() {
        await swapExpectInput(SIDE_R, SIDE_A, 0.1)
    })
    it('R -> B', async function() {
        await swapExpectInput(SIDE_R, SIDE_B, 0.1)
    })
    it('R -> C', async function() {
        await swapExpectInput(SIDE_R, SIDE_C, 0.1)
    })
    it('A -> R', async function() {
        await swapExpectInput(SIDE_A, SIDE_R, 0.01)
    })
    it('B -> R', async function() {
        await swapExpectInput(SIDE_B, SIDE_R, 0.01)
    })
    it('C -> R', async function() {
        await swapExpectInput(SIDE_C, SIDE_R, 0.01)
    })
    it('rA > 50%, open 1e Long, expect wallet loses 1e', async function () {
        const { utr, derivablePools, stateCalHelper, owner, params, oracleLibrary, usdc, weth, uniswapPair } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const config = paramToConfig(params[0])

        await attemptSwap(
            pool,
            0,
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            0,
            stateCalHelper.address,
            utr.address,
            AddressZero,
            owner.address
        )

        await swapToSetPriceMock({
            quoteToken: usdc,
            baseToken: weth,
            uniswapPair,
            targetTwap: 2000,
            targetSpot: 2000
        })
        const state = await pool.getStates()
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
        await attemptSwap(
            pool,
            0,
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            0,
            stateCalHelper.address,
            utr.address,
            AddressZero,
            owner.address
        )
        const wethAfter = await weth.balanceOf(owner.address)
        expect(Number(weiToNumber(wethBefore.sub(wethAfter)))).to.be.eq(1)
    })

    it('rB > 50%, open 1e Short, expect wallet loses 1e', async function () {
        const { utr, derivablePools, stateCalHelper, owner, params, oracleLibrary, usdc, weth, uniswapPair } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const config = paramToConfig(params[0])

        await attemptSwap(
            pool,
            0,
            SIDE_R,
            SIDE_B,
            numberToWei(1),
            0,
            stateCalHelper.address,
            utr.address,
            AddressZero,
            owner.address
        )

        await swapToSetPriceMock({
            quoteToken: usdc,
            baseToken: weth,
            uniswapPair,
            targetTwap: 1000,
            targetSpot: 1000
        })
        const state = await pool.getStates()
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
        await attemptSwap(
            pool,
            0,
            SIDE_R,
            SIDE_B,
            numberToWei(1),
            0,
            stateCalHelper.address,
            utr.address,
            AddressZero,
            owner.address
        )
        const wethAfter = await weth.balanceOf(owner.address)
        expect(Number(weiToNumber(wethBefore.sub(wethAfter)))).to.be.eq(1)
    })
})