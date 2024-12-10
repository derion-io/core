const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { bn, packId } = require("./shared/utilities");
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { loadFixtureFromParams } = require("./shared/scenerios");
const { AddressZero, MaxInt256, MaxUint256 } = require("@ethersproject/constants");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_B } = require("./shared/constant");

const PAYMENT = 0;
const pe = (x) => ethers.utils.parseEther(String(x))

describe("Play Token", async function () {
    const fixture = await loadFixtureFromParams([])

    it("is Token reserve", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper, uniswapPair, derivable1155 } = await loadFixture(fixture)

        const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0

        const oracle = ethers.utils.hexZeroPad(
            bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
            32,
        )

        // deploy PlayDerivable
        const PlayDerivable = await ethers.getContractFactory("PlayDerivable")
        const playToken = await PlayDerivable.deploy(
            owner.address,
            utr.address
        )
        await playToken.deployed()
        await playToken.mint(owner.address, pe(1000000))

        const config = {
            FETCHER: AddressZero,
            ORACLE: oracle,
            TOKEN_R: playToken.address,
            MARK: baseParams.mark,
            K: bn(6),
            INTEREST_HL: baseParams.halfLife,
            PREMIUM_HL: baseParams.premiumHL,
            MATURITY: baseParams.maturity,
            MATURITY_VEST: baseParams.maturityVest,
            MATURITY_RATE: baseParams.maturityRate,
            OPEN_RATE: baseParams.openRate,
        }

        // const tx = await poolFactory.createPool(config)
        // const receipt = await tx.wait()
        // const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))

        const poolAddress = await poolFactory.callStatic.createPool(config)

        const initParams = {
            R: pe(1),
            a: pe(0.03),
            b: pe(0.03),
        }
        const payment = {
            utr: utr.address,
            payer: owner.address,
            recipient: owner.address,
        }

        const pool = await ethers.getContractAt("PoolBase", poolAddress)
        await utr.exec([], [
            {
                inputs: [],
                flags: 0,
                code: poolFactory.address,
                data: (await poolFactory.populateTransaction.createPool(
                    config
                )).data,
            },
            {
                inputs: [{
                    mode: PAYMENT,
                    eip: 20,
                    token: playToken.address,
                    id: 0,
                    amountIn: initParams.R,
                    recipient: poolAddress,
                }],
                flags: 0,
                code: poolAddress,
                data: (await pool.populateTransaction.init(
                    initParams,
                    payment
                )).data,
            }
        ])
        const tokenBBefore = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.address))
        await utr.exec([], [{
            inputs: [{
                mode: PAYMENT,
                eip: 20,
                token: playToken.address,
                id: 0,
                amountIn: pe(1),
                recipient: poolAddress,
            }],
            code: stateCalHelper.address,
            data: (await stateCalHelper.populateTransaction.swap({
                sideIn: SIDE_R,
                poolIn: poolAddress,
                sideOut: SIDE_B,
                poolOut: poolAddress,
                amountIn: pe(1),
                payer: owner.address,
                recipient: owner.address,
                INDEX_R: 0
            })).data,
        }])

        const tokenBAfter = await derivable1155.balanceOf(owner.address, packId(SIDE_B, pool.address))
        expect(tokenBAfter).gt(tokenBBefore)
    })

    it("Token properties", async function() {
        const { owner, utr, accountA } = await loadFixture(fixture)
        // deploy PlayDerivable
        const PlayDerivable = await ethers.getContractFactory("PlayDerivable")
        const playToken = await PlayDerivable.deploy(
            owner.address,
            utr.address
        )
        await playToken.deployed()
        // Mintable, Burnable
        await playToken.mint(owner.address, pe(10000))
        expect(await playToken.balanceOf(owner.address)).eq(pe(10000))

        await playToken.mint(accountA.address, pe(10000))
        expect(await playToken.balanceOf(accountA.address)).eq(pe(10000))
        await playToken.burnFrom(accountA.address, pe(100))
        expect(await playToken.balanceOf(accountA.address)).eq(pe(9900))

        await expect(playToken.connect(accountA).mint(accountA.address, pe(10000))).to.be.revertedWith("OwnableUnauthorizedAccount")
        await expect(playToken.connect(accountA).burnFrom(accountA.address, pe(100))).to.be.revertedWith("OwnableUnauthorizedAccount")
        // Transferable owner
        // // grant role
        // const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))
        // const BURNER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BURNER_ROLE"))
        // await playToken.grantRole(MINTER_ROLE, accountA.address)
        // await expect(playToken.connect(accountA).mint(accountA.address, pe(10000))).revertedWith("OwnableUnauthorizedAccount")
        // // revoke role
        // await playToken.revokeRole(MINTER_ROLE, accountA.address)
        // await expect(playToken.connect(accountA).mint(accountA.address, pe(10000))).to.be.revertedWith("OwnableUnauthorizedAccount")
        // await playToken.grantRole(ethers.utils.hexZeroPad('0x00', 32), accountA.address)
        // await playToken.revokeRole(BURNER_ROLE, owner.address)
        // await playToken.connect(accountA).burnFrom(accountA.address, pe(100))
    })
})