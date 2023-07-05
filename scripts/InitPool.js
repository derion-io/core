const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
require('dotenv').config()
const { AddressZero } = ethers.constants;

const pe = (x) => ethers.utils.parseEther(String(x))
const opts = {
    gasLimit: 6000000
}

async function main(hre) {
    //testnet
    const recipient = "0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07"
    const utrAddress = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    const wethAddress = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"

    const amountInit = pe("0.001")
    const a = pe("0.0004")
    const b = pe("0.0004")

    const addressPath = path.join(__dirname, `./json/ARBTestnet.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    const state = {
        R: amountInit,
        a,
        b
    }
    const payment = {
        utr: AddressZero,
        payer: AddressZero,
        recipient,
    }

    const url = hre.network.config.url
    const account = hre.network.config.accounts[0]
    // Connect to the network
    const provider = new ethers.providers.JsonRpcProvider(url)
    const wallet = new ethers.Wallet(account, provider)
    const poolABI = require("../artifacts/contracts/PoolBase.sol/PoolBase.json").abi
    const pool = new ethers.Contract(addressList["pool^3.5"], poolABI, provider)
    const wethABI = require("canonical-weth/build/contracts/WETH9.json").abi
    const weth = new ethers.Contract(wethAddress, wethABI, provider)
    console.log(state)
    console.log(payment)
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
