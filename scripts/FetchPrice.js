const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
const { bn } = require("../test/shared/utilities")

const opts = {
    gasLimit: 30000000
}

async function main() {
    const addressPath = path.join(__dirname, `./json/ARBMainnet.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    // ganache
    // const qti = 0
    // const windowTime = 60
    // const pairETHUSDC = "0xBf4CC059DfF52AeFe7f12516e4CA4Bc691D97474"

    // testnet
    // const qti = 0
    // const windowTime = 60
    // const pairETHUSDC = "0x12B2483ADd89741e89C25F2E1C798F9fe8EF7664"

    // mainnet
    const qti = 1
    const windowTime = 10800
    const pairETHUSDC = "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443"
    const pairETHPEPE = "0x1944AC04bD9FED9a2BcDB38b70C35949c864ec35"

    const oracle = ethers.utils.hexZeroPad(
        bn(qti).shl(255).add(bn(windowTime).shl(256 - 64)).add(pairETHPEPE).toHexString(),
        32,
    )
    
    const fetchPriceUniV3 = await ethers.getContractAt("FetchPriceUniV3", addressList["fetchPrice"])
    console.log(await fetchPriceUniV3.fetch(oracle))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})