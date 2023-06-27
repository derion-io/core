const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { attemptSwap, numberToWei, paramToConfig, bn, swapToSetPriceMock } = require("./shared/utilities")
const { SIDE_R, SIDE_A } = require("./shared/constant")
const { AddressZero, MaxUint256 } = require("@ethersproject/constants");
const { _selectPrice, _evaluate } = require("./shared/AsymptoticPerpetual")
const { expect } = require("chai")

describe('Input', function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        premiumRate: bn(1).shl(128).div(2)
    }], {})

    it('rA > 50%, open 1e Long, expect wallet loses 1e', async function () {
        const { derivablePools, stateCalHelper, owner, params, oracleLibrary, usdc, weth, uniswapPair } = await loadFixture(fixture)
        const pool = derivablePools[0]
        const config = paramToConfig(params[0])
        await attemptSwap(
            pool,
            0,
            SIDE_R,
            SIDE_A,
            numberToWei(1),
            stateCalHelper.address,
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
            stateCalHelper.address,
            AddressZero,
            owner.address
        )
        const wethAfter = await weth.balanceOf(owner.address)
        expect(wethBefore.sub(wethAfter)).to.be.eq(numberToWei(1))
    })
})