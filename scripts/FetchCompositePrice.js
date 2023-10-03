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

    // arb mainnet
    const qti = 1
    const windowTime = 10800
    const pairETHUSDC = "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
    // QTI(1bit)|SQTI(1bit)|SPI(30bit)|WINDOW(32bit)|SWINDOW(32bit)|POOL(160bit)
    const oracle = bn(wethPepeQti).shl(255)
            .add(bn(usdcWethQti).shl(254))
            .add(bn(0).shl(224))
            .add(bn(300).shl(192))
            .add(bn(300).shl(160))
            .add(pepeWeth.address)
    console.log(oracle)
    
    const compositeFetcher = await ethers.getContractAt("CompositeFetcher", addressList["compositeFetcher"])
    console.log(await compositeFetcher.fetch(oracle))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})