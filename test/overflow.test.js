const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const chai = require("chai")
const { solidity } = require("ethereum-waffle")
chai.use(solidity)
const expect = chai.expect
const { numberToWei, packId, getSqrtPriceFromPrice, bn } = require("./shared/utilities");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { AddressZero, MaxUint256 } = require("@ethersproject/constants");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_B, SIDE_A, SIDE_C } = require("./shared/constant");

const PAYMENT = 0;

const PRICES = [1e20, 1e10, 1e-10, 1e-18]

describe("Price/Mark Overflow/Underflow", function () {
    const fixture = loadFixtureFromParams([])

    for (const PRICE of PRICES) {
        it(`O/U: ${PRICE}`, async function() {
            const { owner, weth, usdc, utr, poolFactory, stateCalHelper, derivable1155 } = await loadFixture(fixture)
        
            // PEPE
            const erc20Factory = await ethers.getContractFactory('USDC')
            const pepe = await erc20Factory.deploy(numberToWei('100000000000000000000'));
    
            // WETH_PEPE
            const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
            const initPrice = getSqrtPriceFromPrice(weth, pepe, 1)
            const price = getSqrtPriceFromPrice(weth, pepe, PRICE)
            const wethPepeQti = pepe.address.toLowerCase() < weth.address.toLowerCase() ? 1 : 0
            const pepeWeth = await Univ3PoolMock.deploy(
                initPrice, 
                initPrice,
                wethPepeQti ? pepe.address : weth.address,
                wethPepeQti ? weth.address : pepe.address,
            )
    
            const usdcWethQti = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
            const oracle = ethers.utils.hexZeroPad(bn(wethPepeQti).shl(255)
                .add(bn(usdcWethQti).shl(254))
                .add(bn(0).shl(224))
                .add(bn(300).shl(192))
                .add(bn(300).shl(160))
                .add(pepeWeth.address).toHexString(),
                32
            )
    
            const config = {
                FETCHER: AddressZero,
                ORACLE: oracle,
                TOKEN_R: weth.address,
                MARK: bn(1).shl(128),
                K: bn(6),
                INTEREST_HL: baseParams.halfLife,
                PREMIUM_HL: baseParams.premiumHL,
                MATURITY: baseParams.maturity,
                MATURITY_VEST: baseParams.maturityVest,
                MATURITY_RATE: baseParams.maturityRate,
                OPEN_RATE: baseParams.openRate,
            }
    
            const tx = await poolFactory.createPool(config)
            const receipt = await tx.wait()
            const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
            const initParams = {
                R: numberToWei(5),
                a: numberToWei(1),
                b: numberToWei(1),
            }
            const payment = {
                utr: utr.address,
                payer: owner.address,
                recipient: owner.address,
            }
            const pool = await ethers.getContractAt("PoolBase", poolAddress)
            await weth.approve(utr.address, MaxUint256);
            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 20,
                    token: weth.address,
                    id: 0,
                    amountIn: numberToWei(5),
                    recipient: poolAddress,
                }],
                flags: 0,
                code: poolAddress,
                data: (await pool.populateTransaction.init(
                    initParams,
                    payment
                )).data,
            }])
    
            await pepeWeth.setPrice(price, price)
    
            async function withdrawAll(side) {
                const ID = packId(side, pool.address)
                const balance = await derivable1155.balanceOf(owner.address, ID)
                return utr.exec([], [{
                    inputs: [{
                        mode: PAYMENT,
                        eip: 1155,
                        token: derivable1155.address,
                        id: ID,
                        amountIn: balance,
                        recipient: poolAddress,
                    }],
                    code: stateCalHelper.address,
                    data: (await stateCalHelper.populateTransaction.swap({
                        sideIn: side,
                        poolIn: poolAddress,
                        sideOut: SIDE_R,
                        poolOut: poolAddress,
                        amountIn: balance.sub(1000),
                        payer: owner.address,
                        recipient: owner.address,
                        INDEX_R: 0
                    })).data,
                }], { gasLimit: 1000000 })
            }

            const [ loser, winner ] = PRICE > 1 ? [ SIDE_B, SIDE_A ] : [ SIDE_A, SIDE_B ]
    
            // await expect(withdrawAll(smallSide)).reverted()
            const { R: before } = await pool.getStates()
            await withdrawAll(SIDE_C)
            const { R: middle } = await pool.getStates()
            expect(before.sub(middle)).lte(0)
            await withdrawAll(winner)
            const { R: after } = await pool.getStates()
            expect(after).lte(5002)
        })
    }
})