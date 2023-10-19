const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { numberToWei, encodePriceSqrt, getSqrtPriceFromPrice, bn, weiToNumber } = require("./shared/utilities");
const { expect } = require("chai");
const { loadFixtureFromParams } = require("./shared/scenerios");
const { AddressZero, MaxInt256, MaxUint256 } = require("@ethersproject/constants");
const { baseParams } = require("./shared/baseParams");
const { SIDE_R, SIDE_B } = require("./shared/constant");

const BTC_WETH = 0.05
const WETH_PEPE = 0.000005
const USDT_WETH = 1600
const USDC_WETH = 1500

const PAYMENT = 0;

describe('Fetcher logic', function () {
    async function fixture () {
        const [signer] = await ethers.getSigners();
        // STABLE COIN
        const erc20Factory = await ethers.getContractFactory('USDC')
        const usdc = await erc20Factory.deploy(numberToWei('100000000000000000000'));
        const usdt = await erc20Factory.deploy(numberToWei('100000000000000000000'));

        // PEPE
        const pepe = await erc20Factory.deploy(numberToWei('100000000000000000000'));

        // WETH
        const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
        const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer);
        const weth = await WETH.deploy();

        // BTC
        const btcFactory = await ethers.getContractFactory('BTC')
        const btc = await btcFactory.deploy(numberToWei('100000000000000000000'))

        // USDC_WETH
        const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
        let price = getSqrtPriceFromPrice(usdc, weth, USDC_WETH)
        const usdcWethQti = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
        const usdcWeth = await Univ3PoolMock.deploy(
            price, 
            price,
            usdcWethQti ? weth.address : usdc.address,
            usdcWethQti ? usdc.address : weth.address,
        )

        // USDT_WETH
        price = getSqrtPriceFromPrice(usdt, weth, USDT_WETH)
        const usdtWethQti = weth.address.toLowerCase() < usdt.address.toLowerCase() ? 1 : 0
        const usdtWeth = await Univ3PoolMock.deploy(
            price, 
            price,
            usdtWethQti ? weth.address : usdt.address,
            usdtWethQti ? usdt.address : weth.address,
        )

        // BTC_WETH
        price = getSqrtPriceFromPrice(btc, weth, BTC_WETH, 10**12)
        const btcWethQti = weth.address.toLowerCase() < btc.address.toLowerCase() ? 1 : 0
        const btcWeth = await Univ3PoolMock.deploy(
            price, 
            price,
            btcWethQti ? weth.address : btc.address,
            btcWethQti ? btc.address : weth.address,
        )

        // WETH_PEPE
        price = getSqrtPriceFromPrice(weth, pepe, WETH_PEPE)
        const wethPepeQti = pepe.address.toLowerCase() < weth.address.toLowerCase() ? 1 : 0
        const pepeWeth = await Univ3PoolMock.deploy(
            price, 
            price,
            wethPepeQti ? pepe.address : weth.address,
            wethPepeQti ? weth.address : pepe.address,
        )

        // FETCHER
        const Fetcher = await ethers.getContractFactory("CompositeFetcher")
        const compositeFetcherV3 = await Fetcher.deploy(
            usdcWeth.address,
            1,
            usdtWeth.address,
            1,
            btcWeth.address,
            1,
            AddressZero
        )

        return {
            pepe,
            weth,
            usdc,
            usdt,
            btc,
            pepeWeth,
            usdcWeth,
            usdtWeth,
            btcWeth,
            usdcWethQti,
            usdtWethQti,
            btcWethQti,
            wethPepeQti,
            compositeFetcherV3
        }
    }

    it("BTC/PEPE", async function() {
        const {
            pepeWeth,
            btcWethQti,
            wethPepeQti,
            compositeFetcherV3
        } = await loadFixture(fixture)

        const pepeBtcOracle = bn(wethPepeQti).shl(255)
        .add(bn(btcWethQti).shl(254))
        .add(bn(2).shl(240))
        .add(bn(1).shl(224))
        .add(bn(300).shl(192))
        .add(bn(300).shl(160))
        .add(pepeWeth.address)

        const {spot, twap} = await compositeFetcherV3.callStatic.fetch(pepeBtcOracle)
        
        const expectedPrice = BTC_WETH * WETH_PEPE
        const actualSpot = (Number(weiToNumber(spot)) / Number(weiToNumber(bn(1).shl(128))))**2 * 10**12
        const actualTwap = (Number(weiToNumber(twap)) / Number(weiToNumber(bn(1).shl(128))))**2 * 10**12
        expect(expectedPrice).to.be.closeTo(actualSpot, 0.00001)
        expect(expectedPrice).to.be.closeTo(actualTwap, 0.00001)
    })


    it("USDT/PEPE", async function() {
        const {
            pepeWeth,
            usdtWethQti,
            wethPepeQti,
            compositeFetcherV3
        } = await loadFixture(fixture)

        const pepeUsdtOracle = bn(wethPepeQti).shl(255)
        .add(bn(usdtWethQti).shl(254))
        .add(bn(1).shl(240))
        .add(bn(1).shl(224))
        .add(bn(300).shl(192))
        .add(bn(300).shl(160))
        .add(pepeWeth.address)

        const {spot, twap} = await compositeFetcherV3.callStatic.fetch(pepeUsdtOracle)
        
        const expectedPrice = USDT_WETH * WETH_PEPE
        const actualSpot = (Number(weiToNumber(spot)) / Number(weiToNumber(bn(1).shl(128))))**2
        const actualTwap = (Number(weiToNumber(twap)) / Number(weiToNumber(bn(1).shl(128))))**2
        expect(expectedPrice).to.be.closeTo(actualSpot, 0.00001)
        expect(expectedPrice).to.be.closeTo(actualTwap, 0.00001)
    })

    it("USDC/PEPE", async function() {
        const {
            pepeWeth,
            usdcWethQti,
            wethPepeQti,
            compositeFetcherV3
        } = await loadFixture(fixture)

        const pepeUsdcOracle = bn(wethPepeQti).shl(255)
        .add(bn(usdcWethQti).shl(254))
        .add(bn(0).shl(240))
        .add(bn(1).shl(224))
        .add(bn(300).shl(192))
        .add(bn(300).shl(160))
        .add(pepeWeth.address)

        const {spot, twap} = await compositeFetcherV3.callStatic.fetch(pepeUsdcOracle)
        
        const expectedPrice = USDC_WETH * WETH_PEPE
        const actualSpot = (Number(weiToNumber(spot)) / Number(weiToNumber(bn(1).shl(128))))**2
        const actualTwap = (Number(weiToNumber(twap)) / Number(weiToNumber(bn(1).shl(128))))**2
        expect(expectedPrice).to.be.closeTo(actualSpot, 0.00001)
        expect(expectedPrice).to.be.closeTo(actualTwap, 0.00001)
    })
})

describe("Pool with CompositeFetcher", function () {
    const fixture = loadFixtureFromParams([], {
        callback: async ({owner, weth, uniswapPair, usdc}) => {
            // PEPE
            const erc20Factory = await ethers.getContractFactory('USDC')
            const pepe = await erc20Factory.deploy(numberToWei('100000000000000000000'));

            // WETH_PEPE
            const Univ3PoolMock = await ethers.getContractFactory("Univ3PoolMock")
            const price = getSqrtPriceFromPrice(weth, pepe, WETH_PEPE)
            const wethPepeQti = pepe.address.toLowerCase() < weth.address.toLowerCase() ? 1 : 0
            const pepeWeth = await Univ3PoolMock.deploy(
                price, 
                price,
                wethPepeQti ? pepe.address : weth.address,
                wethPepeQti ? weth.address : pepe.address,
            )

            // uniswap factory
            const compiledUniswapFactory = require("@uniswap/v2-core/build/UniswapV2Factory.json")
            const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.interface, compiledUniswapFactory.bytecode, owner)
            // uniswap router
            const compiledUniswapRouter = require("@uniswap/v2-periphery/build/UniswapV2Router02")
            const UniswapRouter = await new ethers.ContractFactory(compiledUniswapRouter.abi, compiledUniswapRouter.bytecode, owner)
            const uniswapFactory = await UniswapFactory.deploy(usdc.address)
            const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address)

            await usdc.approve(uniswapRouter.address, ethers.constants.MaxUint256)
            await uniswapRouter.addLiquidityETH(
                usdc.address,
                '10480444925500000000000000',
                '10480444925000000000000000',
                '6986963283651477901852',
                owner.address,
                new Date().getTime() + 100000,
                {
                    value: '6986963283651477901852'
                }
            )
            const pairAddresses = await uniswapFactory.allPairs(0)
            const usdcWethV2Pool = new ethers.Contract(pairAddresses, require("@uniswap/v2-core/build/UniswapV2Pair.json").abi, owner)

            // FETCHER V2
            const FetcherV2Mock = await ethers.getContractFactory("FetcherV2Mock")
            const fetcherV2Mock = await FetcherV2Mock.deploy()
            
            const CompositeFetcher = await ethers.getContractFactory("CompositeFetcher")
            const compositeFetcherV2 = await CompositeFetcher.deploy(
                usdcWethV2Pool.address,
                0,
                AddressZero,
                1,
                AddressZero,
                1,
                fetcherV2Mock.address
            )

            // FETCHER V3
            console.log(uniswapPair.address)
            const compositeFetcherV3 = await CompositeFetcher.deploy(
                uniswapPair.address,
                1,
                AddressZero,
                1,
                AddressZero,
                1,
                fetcherV2Mock.address
            )
            return {
                pepeWeth,
                usdcWethV2Pool,
                compositeFetcherV3,
                wethPepeQti,
                compositeFetcherV2
            }
        }
    })

    it("v3-v3", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper, pepeWeth, compositeFetcherV3, wethPepeQti } = await loadFixture(fixture)
        const usdcWethQti = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
        const oracle = ethers.utils.hexZeroPad(bn(wethPepeQti).shl(255)
            .add(bn(usdcWethQti).shl(254))
            .add(bn(0).shl(240))
            .add(bn(1).shl(224))
            .add(bn(300).shl(192))
            .add(bn(300).shl(160))
            .add(pepeWeth.address).toHexString(),
            32
        )

        const config = {
            FETCHER: compositeFetcherV3.address,
            ORACLE: oracle,
            TOKEN_R: weth.address,
            MARK: encodePriceSqrt(75, 10000).shl(32),
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
    it("v3-v2", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper, pepeWeth, compositeFetcherV2, wethPepeQti } = await loadFixture(fixture)
        const usdcWethQti = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
        const oracle = ethers.utils.hexZeroPad(bn(wethPepeQti).shl(255)
            .add(bn(usdcWethQti).shl(254))
            .add(bn(0).shl(240))
            .add(bn(1).shl(224))
            .add(bn(300).shl(192))
            .add(bn(100).shl(160))
            .add(pepeWeth.address).toHexString(),
            32
        )
        const config = {
            FETCHER: compositeFetcherV2.address,
            ORACLE: oracle,
            TOKEN_R: weth.address,
            MARK: encodePriceSqrt(75, 10000).shl(32),
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

    it("v2-v3", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper, usdcWethV2Pool, compositeFetcherV3 } = await loadFixture(fixture)
        const usdcWethQti = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
        const oracle = ethers.utils.hexZeroPad(bn(usdcWethQti).shl(255)
            .add(bn(usdcWethQti).shl(254))
            .add(bn(0).shl(240))
            .add(bn(0).shl(224))
            .add(bn(100).shl(192))
            .add(bn(300).shl(160))
            .add(usdcWethV2Pool.address).toHexString(),
            32
        )
        const config = {
            FETCHER: compositeFetcherV3.address,
            ORACLE: oracle,
            TOKEN_R: weth.address,
            MARK: bn(2250000).shl(128),
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
        }], {gasLimit: 500000})
    })

    it("v2-v2", async function() {
        const { owner, weth, usdc, utr, poolFactory, stateCalHelper, usdcWethV2Pool, compositeFetcherV2, wethPepeQti } = await loadFixture(fixture)
        const usdcWethQti = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
        const oracle = ethers.utils.hexZeroPad(bn(usdcWethQti).shl(255)
            .add(bn(usdcWethQti).shl(254))
            .add(bn(0).shl(240))
            .add(bn(0).shl(224))
            .add(bn(100).shl(192))
            .add(bn(300).shl(160))
            .add(usdcWethV2Pool.address).toHexString(),
            32
        )
        const config = {
            FETCHER: compositeFetcherV2.address,
            ORACLE: oracle,
            TOKEN_R: weth.address,
            MARK: bn(2250000).shl(128),
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
        }], {gasLimit: 500000})
    })
})