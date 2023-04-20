const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
const { bn } = require("../test/shared/utilities")
const { numberToWei, encodeSqrtX96, packId, delay} = require("./shared/utilities")
const { MaxUint256, AddressZero } = ethers.constants
const opts = {
    gasLimit: 30000000
}
const fe = (x) => Number(ethers.utils.formatEther(x))
const pe = (x) => ethers.utils.parseEther(String(x))
const HALF_LIFE = 10 * 365 * 24 * 60 * 60

// utr
const FROM_ROUTER   = 10
const PAYMENT       = 0
const TRANSFER      = 1
const ALLOWANCE     = 2
const CALL_VALUE    = 3

const abiCoder = new ethers.utils.AbiCoder()

function encodePayload(swapType, sideIn, sideOut, amount) {
    return abiCoder.encode(
        ["uint", "uint", "uint", "uint"],
        [swapType, sideIn, sideOut, amount]
    )
}


async function main() {
    const addressList = {
        "weth": "",
        "uniswapFactory": "",
        "uniswapRouter": "",
        "uniswapPool": "",
        "poolFactory": "",
        "token": "",
        "logic": "",
        "pool": "",
        "tokenInfo": "",
        "pairDetails": "",
        "bna": "",
        "multicall3": "",
        "pairDetailsV3": ""
    }
    const [owner, acc1] = await ethers.getSigners()
    const signer = owner
    // deploy utr
    const UTR = require("@derivable/utr/build/UniversalTokenRouter.json")
    const UniversalRouter = new ethers.ContractFactory(UTR.abi, UTR.bytecode, owner)
    const utr = await UniversalRouter.deploy()
    await utr.deployed()
    console.log('utr: ', utr.address)
    addressList["utr"] = utr.address
    // UNISWAP
    // weth test
    const compiledWETH = require("canonical-weth/build/contracts/WETH9.json")
    const WETH = await new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, signer)
    // uniswap factory
    const compiledUniswapFactory = require("./compiled/UniswapV3Factory.json")
    const UniswapFactory = await new ethers.ContractFactory(compiledUniswapFactory.abi, compiledUniswapFactory.bytecode, signer)
    // uniswap router
    const compiledUniswapv3Router = require("./compiled/SwapRouter.json")
    const UniswapRouter = new ethers.ContractFactory(compiledUniswapv3Router.abi, compiledUniswapv3Router.bytecode, signer)
    // uniswap PM
    const compiledUniswapv3PositionManager = require("./compiled/NonfungiblePositionManager.json")
    const UniswapPositionManager = new ethers.ContractFactory(compiledUniswapv3PositionManager.abi, compiledUniswapv3PositionManager.bytecode, signer)
    // erc20 factory
    const USDC = await ethers.getContractFactory("USDC")
    // setup uniswap
    const usdc = await USDC.deploy(numberToWei(100000000000))
    const weth = await WETH.deploy()
    console.log('usdc: ', usdc.address)
    addressList["usdc"] = usdc.address
    console.log('weth: ', weth.address)
    addressList["weth"] = weth.address
    const uniswapFactory = await UniswapFactory.deploy()
    console.log(`uniswapFactory: ${uniswapFactory.address}`)
    addressList["uniswapFactory"] = uniswapFactory.address
    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory")
    const poolFactory = await PoolFactory.deploy()
    console.log('poolFactory: ', poolFactory.address)
    addressList["poolFactory"] = poolFactory.address

    const uniswapRouter = await UniswapRouter.deploy(uniswapFactory.address, weth.address)
    console.log('uniswapRouter: ', uniswapRouter.address)
    addressList["uniswapRouter"] = uniswapRouter.address
    const uniswapPositionManager = await UniswapPositionManager.deploy(uniswapFactory.address, weth.address, '0x0000000000000000000000000000000000000000')
    console.log('uniswapPositionManager: ', uniswapPositionManager.address)
    addressList["uniswapPositionManager"] = uniswapPositionManager.address

    await uniswapFactory.createPool(usdc.address, weth.address, 500)

    const compiledUniswapPool = require("./compiled/UniswapV3Pool.json")
    const pairAddress = await uniswapFactory.getPool(usdc.address, weth.address, 500)
    const uniswapPair = new ethers.Contract(pairAddress, compiledUniswapPool.abi, signer)
    console.log(`uniswapPool: ${uniswapPair.address}`)
    addressList["uniswapPool"] = uniswapPair.address

    await usdc.approve(uniswapRouter.address, MaxUint256)
    await weth.approve(uniswapRouter.address, MaxUint256)

    const quoteTokenIndex = weth.address.toLowerCase() < usdc.address.toLowerCase() ? 1 : 0
    const initPriceX96 = encodeSqrtX96(quoteTokenIndex ? 1500 : 1, quoteTokenIndex ? 1 : 1500)
    const a = await uniswapPair.initialize(initPriceX96)
    a.wait(1)

    // await time.increase(1000)
    await delay(1000)
    await network.provider.send("evm_increaseTime", [1000])

    // deploy logic
    const AsymptoticPerpetual = await ethers.getContractFactory("AsymptoticPerpetual")
    const asymptoticPerpetual = await AsymptoticPerpetual.deploy()
    await asymptoticPerpetual.deployed()
    console.log('logic: ', asymptoticPerpetual.address)
    addressList["logic"] = asymptoticPerpetual.address

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
        "Test/",
        utr.address
    )
    console.log('token: ', derivable1155.address)
    addressList["token"] = derivable1155.address
    await derivable1155.deployed()

    // deploy ddl pool
    const oracle = ethers.utils.hexZeroPad(
        bn(quoteTokenIndex).shl(255).add(bn(300).shl(256 - 64)).add(uniswapPair.address).toHexString(),
        32,
    )
    const params = {
        utr: utr.address,
        token: derivable1155.address,
        logic: asymptoticPerpetual.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(38).shl(128),
        k: 5,
        a: numberToWei(1),
        b: numberToWei(1),
        initTime: 0,
        halfLife: HALF_LIFE
    }
    const poolAddress = await poolFactory.computePoolAddress(params)
    await delay(1000)
    // await weth.deposit({
    //     value: pe("100")
    // })
    // await weth.transfer(poolAddress, pe("10"))

    await utr.exec(
        [],
        [
            {
                inputs: [
                    {
                        mode: CALL_VALUE,
                        eip: 0,
                        token: AddressZero,
                        id: 0,
                        amountIn: pe("10"),
                        recipient: AddressZero,
                    },
                ],
                flags: 0,
                code: weth.address,
                data: (await weth.populateTransaction.deposit()).data,
            },
            {
                inputs: [
                    {
                        mode: TRANSFER + FROM_ROUTER,
                        eip: 20,
                        token: weth.address,
                        id: 0,
                        amountIn: 0,
                        recipient: poolAddress,
                    },
                ],
                flags: 0,
                code: poolFactory.address,
                data: (
                    await poolFactory.populateTransaction.createPool(
                        params
                    )
                ).data,
            },
        ],
        {
            value: pe("10"),
            gasLimit: 30000000,
        },
    )
    const derivablePool = await ethers.getContractAt("Pool", poolAddress)
    console.log(`pool: ${derivablePool.address}`)
    addressList["pool"] = derivablePool.address

    // deploy ddl pool
    const params1 = {
        utr: utr.address,
        token: derivable1155.address,
        logic: asymptoticPerpetual.address,
        oracle,
        reserveToken: weth.address,
        recipient: owner.address,
        mark: bn(38).shl(128),
        k: 2,
        a: numberToWei(1),
        b: numberToWei(1),
        initTime: 0,
        halfLife: HALF_LIFE
    }
    const poolAddress1 = await poolFactory.computePoolAddress(params1)
    // await weth.deposit({
    //     value: pe("100")
    // })
    // await weth.transfer(poolAddress, pe("10"))
    await delay(1000)
    await utr.exec(
        [],
        [
            {
                inputs: [
                    {
                        mode: CALL_VALUE,
                        eip: 0,
                        token: AddressZero,
                        id: 0,
                        amountIn: pe("10"),
                        recipient: AddressZero,
                    },
                ],
                flags: 0,
                code: weth.address,
                data: (await weth.populateTransaction.deposit()).data,
            },
            {
                inputs: [
                    {
                        mode: TRANSFER + FROM_ROUTER,
                        eip: 20,
                        token: weth.address,
                        id: 0,
                        amountIn: 0,
                        recipient: poolAddress1,
                    },
                ],
                flags: 0,
                code: poolFactory.address,
                data: (
                    await poolFactory.populateTransaction.createPool(
                        params1
                    )
                ).data,
            },
        ],
        {
            value: pe("10"),
            gasLimit: 30000000,
        },
    )
    const derivablePool1 = await ethers.getContractAt("Pool", poolAddress1)
    console.log(`pool1: ${derivablePool1.address}`)
    addressList["pool1"] = derivablePool1.address

    // deploy utility contracts
    const TokenInfo = await hre.ethers.getContractFactory("TokenInfo")
    const tokenInfo = await TokenInfo.deploy()
    await tokenInfo.deployed()
    console.log(`tokenInfo: ${tokenInfo.address}`)
    addressList["tokenInfo"] = tokenInfo.address
    const PairDetails = await hre.ethers.getContractFactory("PairDetails")
    const pairDetails = await PairDetails.deploy()
    await pairDetails.deployed()
    console.log(`pairDetails: ${pairDetails.address}`)
    addressList["pairDetails"] = pairDetails.address
    const BnA = await hre.ethers.getContractFactory("BnA")
    const bna = await BnA.deploy()
    await bna.deployed()
    console.log(`bna: ${bna.address}`)
    addressList["bna"] = bna.address
    const Multicall3 = await hre.ethers.getContractFactory("Multicall3")
    const multicall3 = await Multicall3.deploy()
    await multicall3.deployed()
    console.log(`multicall3: ${multicall3.address}`)
    addressList["multicall3"] = multicall3.address

    // deploy helper
    const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
    const stateCalHelper = await StateCalHelper.deploy(
        derivable1155.address
    )
    await stateCalHelper.deployed()
    console.log(`stateCalHelper: ${stateCalHelper.address}`)
    addressList["stateCalHelper"] = stateCalHelper.address

    const PairDetailsV3 = await ethers.getContractFactory("PairDetailsV3")
    const pairDetailsV3 = await PairDetailsV3.deploy()
    await pairDetailsV3.deployed()
    console.log(`pairDetailsV3: ${pairDetailsV3.address}`)
    addressList["pairDetailsV3"] = pairDetailsV3.address

    await weth.deposit({
        value: numberToWei(10) })
    await weth.approve(utr.address, MaxUint256)

    exportData(addressList)
}

function exportData(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, "AddressList.json"), json)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
