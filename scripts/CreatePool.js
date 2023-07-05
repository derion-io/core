const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
require('dotenv').config()
const { bn, feeToOpenRate } = require("../test/shared/utilities")

const pe = (x) => ethers.utils.parseEther(String(x))
const opts = {
    gasLimit: 6000000
}

const SECONDS_PER_DAY = 60 * 60 * 24

async function main() {
    // mainnet
    // const utr = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    // const usdc = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"
    // const weth = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
    // const pairETHUSDC = "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"

    // testnet
    const utr = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    const usdc = "0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892"
    const weth = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"
    const pairETHUSDC = "0x12B2483ADd89741e89C25F2E1C798F9fe8EF7664"

    // // ganache
    // const utr = "0x4F1111145AB659CF9BBB45442F54A5D427783DaA"
    // const usdc = "0x8F98902cf8255ab9D403Dfa68875b1024cd6C3d4"
    // const weth = "0xaf9173D7fcd8f18d57Ea7EE2b3DeCF263C25679F"
    // const pairETHUSDC = "0xBf4CC059DfF52AeFe7f12516e4CA4Bc691D97474"

    const qti = 0
    const initTime = 0
    const windowTime = 60
    // mainnet
    // const mark = "0x2D9B0000000000000000000000000"
    // testnet
    const mark = bn("3261242127113004532336024318723468369")
    const k = 7
    const amountInit = pe("0.001")
    const a = pe("0.0004")
    const b = pe("0.0004")
    const oracle = ethers.utils.hexZeroPad(
        bn(qti).shl(255).add(bn(windowTime).shl(256 - 64)).add(pairETHUSDC).toHexString(),
        32,
    )
    const dailyFundingRate = (0.01 * k) / 100
    const halfLife = Math.round(
        SECONDS_PER_DAY /
        Math.log2(1 / (1 - dailyFundingRate)))

    const addressPath = path.join(__dirname, `./json/ARBTestnet.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    const premiumRate = 0;

    const param = {
        ORACLE: oracle,
        TOKEN_R: weth,
        MARK: mark,
        K: k,
        INTEREST_HL: halfLife,
        PREMIUM_RATE: premiumRate,
        MATURITY: 0,
        MATURITY_VEST: 0,
        MATURITY_RATE: 0,
        OPEN_RATE: feeToOpenRate(0),
    }
    const state = {
        R: amountInit,
        a,
        b
    }

    console.log(param)
    console.log(state)
    // Create Pool
    const poolFactory = await ethers.getContractAt("contracts/PoolFactory.sol:PoolFactory", addressList["poolFactory"])
    await poolFactory.callStatic.createPool(param)
    const tx = await poolFactory.createPool(param)
    const receipt = await tx.wait()
    const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
    console.log(`pool: ${poolAddress}`)
    addressList["pool^3.5"] = poolAddress
    exportData(addressList)
}

function exportData(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, "/json/ARBTestnet.json"), json)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
