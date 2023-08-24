const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers")
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
const { baseParams } = require("./shared/baseParams")
const { SIDE_A, SIDE_B, SIDE_C } = require("./shared/constant")
const { loadFixtureFromParams } = require("./shared/scenerios")
chai.use(solidity)
const expect = chai.expect
const { packId, decodeDataURI } = require("./shared/utilities")


describe("Shadow metadata spec", function () {
    const fixture = loadFixtureFromParams([baseParams],{
        callback: async ({derivable1155}) => {
            // deploy TestHelper
            const FakePool = await ethers.getContractFactory("contracts/test/FakePool.sol:FakePool")
            const fakePool = await FakePool.deploy(
                derivable1155.address
            )
            await fakePool.deployed()
            return {
                fakePool
            }
        }
    })

    describe("Token Shadow Metadata", function () {
        it("Shadow Name", async function () {
            const {
                derivablePools,
                derivable1155,
                owner,
                fakePool
            } = await loadFixture(fixture)
            
            const derivablePool = derivablePools[0].contract

            const longName = await derivable1155.getShadowName(packId(SIDE_A, derivablePool.address))
            const shortName = await derivable1155.getShadowName(packId(SIDE_B, derivablePool.address))
            const cpName = await derivable1155.getShadowName(packId(SIDE_C, derivablePool.address))

            expect(longName).to.be.equals('Long 2.5x WETH/USDC (WETH)')
            expect(shortName).to.be.equals('Short 2.5x WETH/USDC (WETH)')
            expect(cpName).to.be.equals('LP 2.5x WETH/USDC (WETH)')

            // mint fake token
            const fakeID = packId(SIDE_A, fakePool.address)
            await fakePool.mint(owner.address, fakeID, 1, 0, '0x00')
            await expect(derivable1155.getShadowName(fakeID)).to.be.revertedWith('NOT_A_DERIVABLE_TOKEN')
        })

        it("Shadow Symbol", async function () {
            const {
                derivablePools,
                derivable1155,
                owner,
                fakePool
            } = await loadFixture(fixture)
            
            const derivablePool = derivablePools[0].contract

            const longSymbol = await derivable1155.getShadowSymbol(packId(SIDE_A, derivablePool.address))
            const shortSymbol = await derivable1155.getShadowSymbol(packId(SIDE_B, derivablePool.address))
            const lpSymbol = await derivable1155.getShadowSymbol(packId(SIDE_C, derivablePool.address))

            expect(longSymbol).to.be.equals('WETH+2.5xWETH/USDC')
            expect(shortSymbol).to.be.equals('WETH-2.5xWETH/USDC')
            expect(lpSymbol).to.be.equals('WETH(LP)2.5xWETH/USDC')

            // mint fake token
            const fakeID = packId(SIDE_A, fakePool.address)
            await fakePool.mint(owner.address, fakeID, 1, 0, '0x00')
            await expect(derivable1155.getShadowSymbol(fakeID)).to.be.revertedWith('NOT_A_DERIVABLE_TOKEN')
        })

        it("Shadow Decimals", async function () {
            const {
                derivablePools,
                derivable1155,
                owner,
                fakePool
            } = await loadFixture(fixture)
            
            const derivablePool = derivablePools[0].contract

            const longDecimals = await derivable1155.getShadowDecimals(packId(SIDE_A, derivablePool.address))
            const shortDecimals = await derivable1155.getShadowDecimals(packId(SIDE_B, derivablePool.address))
            const lpDecimals = await derivable1155.getShadowDecimals(packId(SIDE_C, derivablePool.address))

            expect(longDecimals).to.be.equals(18)
            expect(shortDecimals).to.be.equals(18)
            expect(lpDecimals).to.be.equals(18)

            // mint fake token
            const fakeID = packId(SIDE_A, fakePool.address)
            await fakePool.mint(owner.address, fakeID, 1, 0, '0x00')
            await expect(derivable1155.getShadowDecimals(fakeID)).to.be.revertedWith('NOT_A_DERIVABLE_TOKEN')
        })

        it("Token name (symbol)", async function () {
            const {
                derivable1155
            } = await loadFixture(fixture)
            expect(await derivable1155.name()).to.be.equals('Derivable Position')
            expect(await derivable1155.symbol()).to.be.equals('DERIVABLE-POS')
        })

        it("Token metadata", async function () {
            const {
                derivablePools,
                derivable1155,
                owner,
                fakePool
            } = await loadFixture(fixture)
            
            const derivablePool = derivablePools[0].contract
            const logosvg = '<svg width="148" height="137" viewBox="0 0 148 137" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M80.0537 108.183V136.31H0V0H84.1578C114.181 0 147.129 23.5 147.129 69.2369H119.001C119.001 47.5 103.681 29.0301 84.1578 29.0301H28.7107V108.183H80.0537Z" fill="#01A7FA"/>' +
                '<mask id="path-2-inside-1_164_13183" fill="white">' +
                '<path fill-rule="evenodd" clip-rule="evenodd" d="M56.255 51.9277H88.7098V77.0548L105.473 90.8735H147.128V136.31H99.5281V99.3905L81.322 84.3825H56.255V51.9277Z"/>' +
                '</mask>' +
                '<path fill-rule="evenodd" clip-rule="evenodd" d="M56.255 51.9277H88.7098V77.0548L105.473 90.8735H147.128V136.31H99.5281V99.3905L81.322 84.3825H56.255V51.9277Z" fill="#F2F2F2"/>' +
                '<path d="M88.7098 51.9277H89.2098V51.4277H88.7098V51.9277ZM56.255 51.9277V51.4277H55.755V51.9277H56.255ZM88.7098 77.0548H88.2098V77.2906L88.3918 77.4406L88.7098 77.0548ZM105.473 90.8735L105.155 91.2593L105.294 91.3735H105.473V90.8735ZM147.128 90.8735H147.628V90.3735H147.128V90.8735ZM147.128 136.31V136.81H147.628V136.31H147.128ZM99.5281 136.31H99.0281V136.81H99.5281V136.31ZM99.5281 99.3905H100.028V99.1547L99.8461 99.0047L99.5281 99.3905ZM81.322 84.3825L81.64 83.9967L81.5015 83.8825H81.322V84.3825ZM56.255 84.3825H55.755V84.8825H56.255V84.3825ZM88.7098 51.4277H56.255V52.4277H88.7098V51.4277ZM89.2098 77.0548V51.9277H88.2098V77.0548H89.2098ZM88.3918 77.4406L105.155 91.2593L105.791 90.4877L89.0279 76.669L88.3918 77.4406ZM147.128 90.3735H105.473V91.3735H147.128V90.3735ZM147.628 136.31V90.8735H146.628V136.31H147.628ZM99.5281 136.81H147.128V135.81H99.5281V136.81ZM99.0281 99.3905V136.31H100.028V99.3905H99.0281ZM99.8461 99.0047L81.64 83.9967L81.0039 84.7684L99.21 99.7763L99.8461 99.0047ZM56.255 84.8825H81.322V83.8825H56.255V84.8825ZM55.755 51.9277V84.3825H56.755V51.9277H55.755Z" fill="#01A7FA" mask="url(#path-2-inside-1_164_13183)"/>' +
                '</svg>'
            const longMetadata = await derivable1155.uri(packId(SIDE_A, derivablePool.address))
            const shortMetadata = await derivable1155.uri(packId(SIDE_B, derivablePool.address))
            const lpMetadata = await derivable1155.uri(packId(SIDE_C, derivablePool.address))

            // longMetadata
            expect(decodeDataURI(longMetadata).name).to.be.equals('Long 2.5x WETH/USDC (WETH)')
            expect(decodeDataURI(longMetadata).description).to.be.equals('This fungible token represents a Derivable LONG x2.5 position for the WETH/USDC pool at '
                + derivablePool.address.toLowerCase() + ' with WETH as the reserve token.')
            expect(decodeDataURI(longMetadata).image.substring(26)).to.be.equals(Buffer.from(logosvg).toString('base64'))

            // shortMetadata
            expect(decodeDataURI(shortMetadata).name).to.be.equals('Short 2.5x WETH/USDC (WETH)')
            expect(decodeDataURI(shortMetadata).description).to.be.equals('This fungible token represents a Derivable SHORT x2.5 position for the WETH/USDC pool at '
                + derivablePool.address.toLowerCase() + ' with WETH as the reserve token.')
            expect(decodeDataURI(shortMetadata).image.substring(26)).to.be.equals(Buffer.from(logosvg).toString('base64'))

            // lpMetadata
            expect(decodeDataURI(lpMetadata).name).to.be.equals('LP 2.5x WETH/USDC (WETH)')
            expect(decodeDataURI(lpMetadata).description).to.be.equals('This is a Derivable Liquidity Provider token for the WETH/USDC x2.5 pool at '
                + derivablePool.address.toLowerCase() + ' with WETH as the reserve token.')
            expect(decodeDataURI(lpMetadata).image.substring(26)).to.be.equals(Buffer.from(logosvg).toString('base64'))

            // mint fake token
            const fakeID = packId(SIDE_A, fakePool.address)
            await fakePool.mint(owner.address, fakeID, 1, 0, '0x00')
            await expect(derivable1155.uri(fakeID)).to.be.revertedWith('NOT_A_DERIVABLE_TOKEN')
        })

        it("Descriptor can only be set by setter", async function () {
            const {
                derivable1155,
                accountA
            } = await loadFixture(fixture)

            const txSignerA = await derivable1155.connect(accountA)
            await expect(txSignerA.setDescriptor(accountA.address)).to.be.revertedWith('UNAUTHORIZED')
            await expect(txSignerA.setDescriptorSetter(accountA.address)).to.be.revertedWith('UNAUTHORIZED')
        })
    })
})

