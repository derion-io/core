const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
require('dotenv').config()
const { AddressZero } = ethers.constants;
const { calculateInitParams } = require("../test/shared/AsymptoticPerpetual")
const bn = ethers.BigNumber.from

const pe = (x) => ethers.utils.parseEther(String(x))
const opts = {
    gasLimit: 6000000
}

async function main(hre) {
    const url = hre.network.config.url
    const account = hre.network.config.accounts[0]
    // Connect to the network
    const provider = new ethers.providers.JsonRpcProvider(url)
    const wallet = new ethers.Wallet(account, provider)

    //testnet
    // const recipient = "0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07"
    // const wethAddress = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"

    //mainnet
    const recipient = "0xFf6a4D6C03750c0d6449cCF3fF21e1E085c8f26b"
    const wethAddress = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"

    const addressPath = path.join(__dirname, `./json/ARBMainnet.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    const amountInit = pe("0.001")
    const fetchPriceABI = require("../artifacts/contracts/test/FetchPriceUniV3.sol/FetchPriceUniV3.json").abi
    const fetchPrice = new ethers.Contract(addressList["fetchPrice"], fetchPriceABI, provider)
    const config = {
        ORACLE: "0x800000000000003c00000000c31e54c7a869b9fcbecc14363cf510d1c41fa443",
        K: bn(24),
        MARK: bn("15065122318819189091263847637975040")
    }
    const state = await calculateInitParams(config, fetchPrice, amountInit)

    const payment = {
        utr: AddressZero,
        payer: AddressZero,
        recipient,
    }

    console.log(state)
    console.log(payment)
    
    const poolABI = require("../artifacts/contracts/PoolBase.sol/PoolBase.json").abi
    const pool = new ethers.Contract(addressList["pool^12-1"], poolABI, provider)
    const wethABI = require("canonical-weth/build/contracts/WETH9.json").abi
    const weth = new ethers.Contract(wethAddress, wethABI, provider)

    await weth.connect(wallet).deposit({value: amountInit})
    await weth.connect(wallet).approve(pool.address, amountInit)
    await pool.connect(wallet).init(state, payment)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main(hre).catch((error) => {
    console.error(error)
    process.exitCode = 1
})
