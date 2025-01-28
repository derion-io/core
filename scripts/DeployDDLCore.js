const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')

const opts = {
  gasPrice: 87000000000,
}

async function main() {
  const addressPath = path.join(__dirname, `./json/${process.env.addr}.json`)
  const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

  const url = hre.network.config.url
  console.log('url: ', url)
  const account = hre.network.config.accounts[0]
  // Connect to the network
  const provider = new ethers.providers.JsonRpcProvider(url)
  const deployer = new ethers.Wallet(account, provider)
  console.log('account: ', deployer.address)
  console.log('Balance: ', await provider.getBalance(deployer.address))

  // mainnet
  const weth = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"
  const utr = "0xAe68B2DcCd3aD80a5adD5E7e566d243F64fF8BA9"
  const admin = "0xBe9536bEF1137915Dcb047BB7a915ee9b0961DE4"

  // testnet
  // const weth = "0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3"
  // const utr = "0xAe68B2DcCd3aD80a5adD5E7e566d243F64fF8BA9"
  // const admin = "0x61015a24ee8a44424dAae53532680314B7672cDa"

  const feeRate = 5

  // ganache
  // const utr = "0x4F1111145AB659CF9BBB45442F54A5D427783DaA"
  // const weth = "0xaf9173D7fcd8f18d57Ea7EE2b3DeCF263C25679F"

  // deploy weth
  // const compiledWETH = require("canonical-weth/build/contracts/WETH9.json");
  // const WETH = new ethers.ContractFactory(compiledWETH.abi, compiledWETH.bytecode, deployer);
  // const weth = await WETH.deploy(opts);
  // await weth.deployed()
  // console.log('WETH: ', weth.address)
  // addressList["WETH"] = weth.address

  // deploy token1155
  const Token = await ethers.getContractFactory("Token")
  const derivable1155 = await Token.deploy(
    utr,
    admin,
    ethers.constants.AddressZero,
    opts
  )
  await derivable1155.deployed()
  console.log('token: ', derivable1155.address)
  addressList["token"] = derivable1155.address

  // deploy fee receiver
  const FeeReceiver = await ethers.getContractFactory("FeeReceiver")
  const feeReceiver = await FeeReceiver.deploy(admin, opts)
  await feeReceiver.deployed()
  console.log('feeReceiver: ', feeReceiver.address)
  addressList["feeReceiver"] = feeReceiver.address

  // logic
  const Logic = await ethers.getContractFactory("PoolLogic")
  const logic = await Logic.deploy(
    feeRate,
    opts
  )
  await logic.deployed()
  console.log('logic: ', logic.address)
  addressList["logic"] = logic.address

  // deploy pool factory
  const PoolFactory = await ethers.getContractFactory("PoolFactory");
  const poolFactory = await PoolFactory.deploy(
    logic.address,
    opts
  )
  await poolFactory.deployed()
  console.log(`poolFactory: ${poolFactory.address}`)
  addressList["poolFactory"] = poolFactory.address

  // deploy descriptor
  const TokenDescriptor = await ethers.getContractFactory("TokenDescriptor")
  const tokenDescriptor = await TokenDescriptor.deploy(addressList["poolFactory"], opts)
  await tokenDescriptor.deployed()
  console.log('tokenDescriptor: ', tokenDescriptor.address)
  addressList["tokenDescriptor"] = tokenDescriptor.address

  // deploy stateCalHelper
  const StateCalHelper = await ethers.getContractFactory("contracts/support/Helper.sol:Helper")
  const stateCalHelper = await StateCalHelper.deploy(
    addressList["token"],
    addressList["WETH"],
    opts
  )
  await stateCalHelper.deployed()
  console.log(`stateCalHelper: ${stateCalHelper.address}`)
  addressList["stateCalHelper"] = stateCalHelper.address

  exportData(addressList)
}

function exportData(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2)
  fs.writeFileSync(path.join(__dirname, `/json/${process.env.addr}.json`), json)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
})
