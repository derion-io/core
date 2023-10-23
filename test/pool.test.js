const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { numberToWei, encodePriceSqrt, getSqrtPriceFromPrice, bn, weiToNumber } = require("./shared/utilities");
const { expect } = require("chai");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { AddressZero, MaxInt256, MaxUint256 } = require("@ethersproject/constants");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_B } = require("./shared/constant");

const PAYMENT = 0;
const WETH_PEPE_HUGE = 2250000;
const WETH_PEPE_SMALL = 0.0000000001;

describe("Price/Mark big gap", function () {
    const fixture = loadFixtureFromParams([])

    it("Price/Mark = huge value", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper } = await loadFixture(fixture)
    
        // PEPE
        const erc20Factory = await ethers.getContractFactory('USDC')
        const pepe = await erc20Factory.deploy(numberToWei('100000000000000000000'));

        // WETH_PEPE
        const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
        const price = getSqrtPriceFromPrice(weth, pepe, WETH_PEPE_HUGE)
        const wethPepeQti = pepe.address.toLowerCase() < weth.address.toLowerCase() ? 1 : 0
        const pepeWeth = await Univ3PoolMock.deploy(
            price, 
            price,
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

            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 20,
                    token: weth.address,
                    id: 0,
                    amountIn: numberToWei(0.0001),
                    recipient: poolAddress,
                }],
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: SIDE_R,
                    poolIn: poolAddress,
                    sideOut: SIDE_B,
                    poolOut: poolAddress,
                    amountIn: numberToWei(0.0001),
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }])
    })

    it("Price/Mark = small value", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper } = await loadFixture(fixture)
    
        // PEPE
        const erc20Factory = await ethers.getContractFactory('USDC')
        const pepe = await erc20Factory.deploy(numberToWei('100000000000000000000'));

        // WETH_PEPE
        const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
        const price = getSqrtPriceFromPrice(weth, pepe, WETH_PEPE_SMALL)
        const wethPepeQti = pepe.address.toLowerCase() < weth.address.toLowerCase() ? 1 : 0
        const pepeWeth = await Univ3PoolMock.deploy(
            price, 
            price,
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

            await utr.exec([], [{
                inputs: [{
                    mode: PAYMENT,
                    eip: 20,
                    token: weth.address,
                    id: 0,
                    amountIn: numberToWei(0.0001),
                    recipient: poolAddress,
                }],
                code: stateCalHelper.address,
                data: (await stateCalHelper.populateTransaction.swap({
                    sideIn: SIDE_R,
                    poolIn: poolAddress,
                    sideOut: SIDE_B,
                    poolOut: poolAddress,
                    amountIn: numberToWei(0.0001),
                    payer: owner.address,
                    recipient: owner.address,
                    INDEX_R: 0
                })).data,
            }])
    })
})