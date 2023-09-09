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

    // ganache
    // const qti = 0
    // const windowTime = 60
    // const pairETHUSDC = "0xBf4CC059DfF52AeFe7f12516e4CA4Bc691D97474"

    // arb testnet
    // const qti = 0
    // const windowTime = 60
    // const pairETHUSDC = "0x12B2483ADd89741e89C25F2E1C798F9fe8EF7664"

    // arb mainnet
    // const qti = 1
    // const windowTime = 10800
    // const pairETHUSDC = "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
    // const pairETHPEPE = "0x1944AC04bD9FED9a2BcDB38b70C35949c864ec35"

    // op testnet
    // const qti = 0
    // const windowTime = 60
    // const pairETHUSDC = "0xe987b9F1aDf0a1A290703f8CD40fbfb3F19DDC50"

    // base testnet
    // const qti = 1
    // const windowTime = 60
    // const pairETHUSDC = "0xc357410bFf9Db82c8825eb29756E2C7993E2844D"

    // base mainnet
    const qti = 0
    const windowTime = 600
    const pairETHTOSHI = "0xE6E16fA8f4C2b9f56A3378b227bEdE63940a657C"
    const pairETHBALD = "0x9E37cb775a047Ae99FC5A24dDED834127c4180cD"
    const pairETHGOLD = "0x6d03360cE4764E862Ed81660c1f76CC2711b14B6"

    const oracle = ethers.utils.hexZeroPad(
        bn(qti).shl(255).add(bn(windowTime).shl(256 - 64)).add(pairETHGOLD).toHexString(),
        32,
    )
    
    const fetchPriceUniV3 = await ethers.getContractAt("Fetcher", addressList["fetchPrice"])
    console.log(await fetchPriceUniV3.fetch(oracle))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})