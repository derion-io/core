const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { baseParams } = require("./shared/baseParams")
const { SIDE_A, SIDE_B, SIDE_R } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { bn, packId, weiToNumber } = require("./shared/utilities")

const pe = (x) => ethers.utils.parseEther(String(x))


const HALF_LIFE = 10 * 365 * 24 * 60 * 60

describe("Order", async function () {
    const fixture = await loadFixtureFromParams([{
        ...baseParams,
        k: bn(64),
        a: bn('400000000000000'),
        b: bn('400000000000000'),
        halfLife: bn(HALF_LIFE)
    }], {initReserved: 0.01})

    describe("Multi position", function () {
        it("Long 1e - short 1e - price -3%", async function () {
            const {accountA, accountB, weth, derivablePools, derivable1155} = await loadFixture(fixture)

            const poolA = derivablePools[0].connect(accountA)
            const poolB = derivablePools[0].connect(accountB)

            // swap eth -> long
            
            const longTokenBefore = await derivable1155.balanceOf(accountA.address, packId(SIDE_A, poolA.contract.address))
            
            await poolA.swap(
                SIDE_R,
                SIDE_A,
                pe(1),
            )
            const longTokenAfter = await derivable1155.balanceOf(accountA.address, packId(SIDE_A, poolA.contract.address))
            const longToken = longTokenAfter.sub(longTokenBefore)
            // swap eth -> short
            
            const shortTokenBefore = await derivable1155.balanceOf(accountB.address, packId(SIDE_B, poolA.contract.address))
            
            await poolB.swap(
                SIDE_R,
                SIDE_B,
                pe(1),
            )
            
            const shortTokenAfter = await derivable1155.balanceOf(accountB.address, packId(SIDE_B, poolA.contract.address))
            const shortToken = shortTokenAfter.sub(shortTokenBefore)

            // swap back
            const bWethBefore = await weth.balanceOf(accountB.address)
            const aWethBefore = await weth.balanceOf(accountA.address)
            await poolA.swap(
                SIDE_A,
                SIDE_R,
                longToken,
            )

            await poolB.swap(
                SIDE_B,
                SIDE_R,
                shortToken,
            )

            const aWethAfter = await weth.balanceOf(accountA.address)
            const bWethAfter = await weth.balanceOf(accountB.address)

            const longValue = weiToNumber(aWethAfter.sub(aWethBefore))
            const shortValue = weiToNumber(bWethAfter.sub(bWethBefore))

            expect(longValue/shortValue).closeTo(1, 0.00001)
        })
    })
})