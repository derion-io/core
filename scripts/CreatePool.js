const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
require('dotenv').config()
const { bn, feeToOpenRate, toHalfLife } = require("../test/shared/utilities")
const { AddressZero } = ethers.constants

const pe = (x) => ethers.utils.parseEther(String(x))
const opts = {
    gasLimit: 20000000
}

const SECONDS_PER_DAY = 60 * 60 * 24

async function main() {
    // arb mainnet
    // const utr = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    // const usdc = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"
    // const weth = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
    // const pairETHUSDC = "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
    // const pairETHPEPE = "0x1944AC04bD9FED9a2BcDB38b70C35949c864ec35"

    // arb testnet
    // const utr = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    // const usdc = "0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892"
    // const weth = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"
    // const pairETHUSDC = "0x12B2483ADd89741e89C25F2E1C798F9fe8EF7664"
    
    // base testnet
    // const utr = "0xb29647dd03F9De2a9Fe9e32DF431dA5015c60353"
    // const usdc = "0x5010B0988a035915C91a2a432085824FcB3D8d3f"
    // const weth = "0x4200000000000000000000000000000000000006"
    // const pairETHUSDC = "0xc357410bFf9Db82c8825eb29756E2C7993E2844D"

    // base mainnet
    const weth = "0x4200000000000000000000000000000000000006"
    const pairETHTOSHI = "0xE6E16fA8f4C2b9f56A3378b227bEdE63940a657C"
    const pairETHBALD = "0x9E37cb775a047Ae99FC5A24dDED834127c4180cD"
    const pairETHGOLD = "0x6d03360cE4764E862Ed81660c1f76CC2711b14B6"

    // // ganache
    // const utr = "0x4F1111145AB659CF9BBB45442F54A5D427783DaA"
    // const usdc = "0x8F98902cf8255ab9D403Dfa68875b1024cd6C3d4"
    // const weth = "0xaf9173D7fcd8f18d57Ea7EE2b3DeCF263C25679F"
    // const pairETHUSDC = "0xBf4CC059DfF52AeFe7f12516e4CA4Bc691D97474"

    const qti = 0
    const windowTime = 600
    // mainnet
    const mark = bn("25749232743142286765615296200967951798")
    const k = 20
    const oracle = ethers.utils.hexZeroPad(
        bn(qti).shl(255).add(bn(windowTime).shl(256 - 64)).add(pairETHGOLD).toHexString(),
        32,
    )
    const DAILY_INTEREST_RATE = (0.03 * k) / 100
    const DAILY_PREMIUM_RATE = (0.5 * k) / 100

    const addressPath = path.join(__dirname, `./json/${process.env.addr}.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    const param = {
        FETCHER: AddressZero,
        ORACLE: oracle,
        TOKEN_R: weth,
        MARK: mark,
        K: k,
        INTEREST_HL: toHalfLife(DAILY_INTEREST_RATE),
        PREMIUM_HL: toHalfLife(DAILY_PREMIUM_RATE),
        MATURITY: 60 * 60 * 24,
        MATURITY_VEST: 60 * 60 * 4,
        MATURITY_RATE: bn(97).shl(128).div(100),
        OPEN_RATE: feeToOpenRate(0),
    }

    console.log(param)
    // Create Pool
    const poolFactory = await ethers.getContractAt("contracts/PoolFactory.sol:PoolFactory", addressList["poolFactory"])
    await poolFactory.callStatic.createPool(param)
    const tx = await poolFactory.createPool(param)
    const receipt = await tx.wait()
    const poolAddress = ethers.utils.getAddress('0x' + receipt.logs[0].data.slice(-40))
    console.log(`pool: ${poolAddress}`)
    addressList["pool-GOLD^10-1"] = poolAddress
    exportData(addressList)
}

function exportData(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, `/json/${process.env.addr}.json`), json)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
