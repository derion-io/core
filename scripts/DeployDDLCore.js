const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')

const opts = {
    gasLimit: 30000000
}

async function main() {
    const tokenURI = "https://raw.githubusercontent.com/derivable-labs/metadata/token/"
    // mainnet
    // const weth = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
    // const utr = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    // const descriptorSetter = "0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07"

    // testnet
    const weth = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"
    const utr = "0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834"
    const admin = "0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07"
    const feeRate = 12

    // ganache
    // const utr = "0x4F1111145AB659CF9BBB45442F54A5D427783DaA"
    // const weth = "0xaf9173D7fcd8f18d57Ea7EE2b3DeCF263C25679F"

    const addressList = {
        "poolFactory": "",
        "logic": "",
        "tokenDescriptor": "",
        "feeReceiver": "",
        "token": "",
        "stateCalHelper": ""
    }

    // deploy descriptor
    const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
    const tokenDescriptor = await TokenDescriptor.deploy()
    await tokenDescriptor.deployed()
    console.log('tokenDescriptor: ', tokenDescriptor.address)
    addressList["tokenDescriptor"] = tokenDescriptor.address

    // deploy token1155
    const Token = await ethers.getContractFactory("Token")
    const derivable1155 = await Token.deploy(
      utr.address,
      admin,
      tokenDescriptor.address
    )
    await derivable1155.deployed()
    console.log('token: ', derivable1155.address)
    addressList["token"] = derivable1155.address

    // deploy fee receiver
    const FeeReceiver = await ethers.getContractFactory("FeeReceiver")
    const feeReceiver = await FeeReceiver.deploy(admin)
    await feeReceiver.deployed()
    console.log('feeReceiver: ', feeReceiver.address)
    addressList["feeReceiver"] = feeReceiver.address

    // logic
    const Logic = await ethers.getContractFactory("PoolLogic")
    const logic = await Logic.deploy(
      derivable1155.address,
      feeReceiver.address,
      feeRate,
    )
    console.log('logic: ', logic.address)
    addressList["logic"] = logic.address

    // deploy pool factory
    const PoolFactory = await ethers.getContractFactory("PoolFactory");
    const poolFactory = await PoolFactory.deploy(
      logic.address
    )
    console.log(`poolFactory: ${poolFactory.address}`)
    addressList["poolFactory"] = poolFactory.address

    // deploy stateCalHelper
    const StateCalHelper = await ethers.getContractFactory("contracts/Helper.sol:Helper")
    const stateCalHelper = await StateCalHelper.deploy(
        derivable1155.address,
        weth
    )
    await stateCalHelper.deployed()
    console.log(`stateCalHelper: ${stateCalHelper.address}`)
    addressList["stateCalHelper"] = stateCalHelper.address

    exportData(addressList)
}

function exportData(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, "/json/ARBTestnet.json"), json)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})
