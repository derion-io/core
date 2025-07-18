const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
require('dotenv').config()
const { AddressZero } = ethers.constants;
const { calculateInitParams } = require("../test/shared/AsymptoticPerpetual")
const bn = ethers.BigNumber.from

const pe = (x) => ethers.utils.parseEther(String(x))
const opts = {
    gasLimit: 2000000
}

async function main(hre) {
    const url = hre.network.config.url
    const account = hre.network.config.accounts[0]
    // Connect to the network
    const provider = new ethers.providers.JsonRpcProvider(url)
    const wallet = new ethers.Wallet(account, provider)

    // arb testnet
    // const recipient = "0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07"
    // const wethAddress = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"

    // arb mainnet
    // const recipient = "0xFf6a4D6C03750c0d6449cCF3fF21e1E085c8f26b"
    // const wethAddress = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"

    // base testnet
    // const recipient = "0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07"
    // const wethAddress = "0x4200000000000000000000000000000000000006"

    // base mainnet
    const recipient = "0xFf6a4D6C03750c0d6449cCF3fF21e1E085c8f26b"
    const wethAddress = "0x4200000000000000000000000000000000000006"

    const addressPath = path.join(__dirname, `./json/${process.env.addr}.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    const amountInit = pe("0.001")
    const fetchPriceABI = require("../artifacts/contracts/Fetcher.sol/Fetcher.json").abi
    const fetchPrice = new ethers.Contract(addressList["fetchPrice"], fetchPriceABI, provider)
    const config = {
        ORACLE: "0x0000000000000258000000006d03360ce4764e862ed81660c1f76cc2711b14b6",
        K: bn(12),
        MARK: bn("23858931712913708623624001054981381503")
    }
    const state = await calculateInitParams(config, fetchPrice, amountInit)
    // const state = {
    //     R: bn("1000000000000000"),
    //     a: bn("300000000000000"),
    //     b: bn("300000000000000")
    // }

    const payment = {
        utr: AddressZero,
        payer: [],
        recipient,
    }

    console.log(state)
    console.log(payment)
    
    const poolABI = require("../artifacts/contracts/PoolBase.sol/PoolBase.json").abi
    const pool = new ethers.Contract(addressList["pool-GOLD^6-1"], poolABI, provider)
    const wethABI = require("canonical-weth/build/contracts/WETH9.json").abi
    const weth = new ethers.Contract(wethAddress, wethABI, provider)

    // await weth.connect(wallet).deposit({value: amountInit})
    // await weth.connect(wallet).approve(pool.address, amountInit)
    // await pool.connect(wallet).init(state, payment)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main(hre).catch((error) => {
    console.error(error)
    process.exitCode = 1
})
