const fs = require('fs')
const path = require('path')

async function main() {
    // Get the hardhat runtime environment
    const hre = require("hardhat");
    const { ethers } = hre;
    
    // Check if addr environment variable is set
    if (!process.env.addr) {
        console.error("Error: process.env.addr is not set. Please set the addr environment variable.");
        process.exit(1);
    }
    
    const addressPath = path.join(__dirname, `./json/${process.env.addr}.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

    // Use the configured network URL instead of hardcoding
    const provider = ethers.provider;
    const [deployer] = await ethers.getSigners();
    
    console.log('account: ', deployer.address)
    console.log('Balance: ', ethers.utils.formatEther(await provider.getBalance(deployer.address)), "ETH")

    console.log("Deploying Chainlink Fetcher contract...");
    // deploy Chainlink Fetcher
    const ChainlinkFetcher = await ethers.getContractFactory("ChainlinkFetcher", deployer)
    const fetcher = await ChainlinkFetcher.deploy()

    console.log("Waiting for deployment transaction...");
    await fetcher.deployed()

    console.log(`Chainlink Fetcher deployed to: ${fetcher.address}`)
    addressList["ChainlinkFetchPrice"] = fetcher.address

    exportData(addressList)
}

function exportData(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, `/json/${process.env.addr}.json`), json)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });