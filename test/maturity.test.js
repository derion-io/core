const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")
const { baseParams } = require("./shared/baseParams")
const { loadFixtureFromParams } = require("./shared/scenerios")
const { attemptSwap, weiToNumber } = require("./shared/utilities")
const { SIDE_R, SIDE_A } = require("./shared/constant")
const { AddressZero } = require("@ethersproject/constants")

describe('Maturity', function () {
    const fixture = loadFixtureFromParams([{
        ...baseParams,
        minExpirationC: 60,
        minExpirationD: 60
    }], {})

    it('User should get amountOut = 0 if t < maturity', async function () {
        const {owner, derivablePools, stateCalHelper} = await loadFixture(fixture)
        const derivablePool = derivablePools[0]

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            SIDE_A,
            weiToNumber(1),
            stateCalHelper.address,
            AddressZero,
            owner.address
        )
    })

    it('User should get amountOut > 0 if t > maturity', async function () {
        const {owner, derivablePools, stateCalHelper} = await loadFixture(fixture)
        const derivablePool = derivablePools[0]

        await attemptSwap(
            derivablePool,
            0,
            SIDE_R,
            SIDE_A,
            weiToNumber(1),
            stateCalHelper.address,
            AddressZero,
            owner.address
        )
    })
})