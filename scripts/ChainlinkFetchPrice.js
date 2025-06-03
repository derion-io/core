const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
const { bn } = require("../test/shared/utilities")

const opts = {
    gasLimit: 30000000
}

async function main() {
    const addressPath = path.join(__dirname, `./json/${process.env.addr}.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
    const feed = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612" // price ETH/USD on Arbitrum mainnet
    // convert 0.5% deviation to 32bit
    const deviation = bn(5).mul(bn(2).pow(bn(32))).div(1000).toHexString()
    // decimals is 8 for ETH/USD
    const decimals = 8
    // DEVIATION(32bit)|DECIMALS(32bit) ... FEED(160bit)
    const oracle = ethers.utils.hexZeroPad(
        bn(deviation).shl(256 - 32)
        .add(bn(decimals).shl(256 - 64))
        .add(feed).toHexString(),
        32,
    )
    const chainlinkFetchPrice = await ethers.getContractAt("ChainlinkFetcher", addressList["ChainlinkFetchPrice"])
    console.log(await chainlinkFetchPrice.fetch(oracle))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})