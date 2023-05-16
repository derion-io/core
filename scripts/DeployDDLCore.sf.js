const fs = require('fs')
const path = require('path')
const { packId } = require("../test/shared/utilities")

const opts = {
    gasLimit: 30000000
}

// mainnet arb
// const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
// const utr = '0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834'

// testnet arb
const weth = '0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3'
const utr = '0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834'

const singletonFactoryAddress = '0xce0042B868300000d44A59004Da54A005ffdcf9f'

task('deployPoolFactory', 'Use SingletonFatory to deploy PoolFactory contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const url = hre.network.config.url
            const account = hre.network.config.accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/PoolFactory.sol/PoolFactory.json').bytecode
            const feeToSetter = '0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07'

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address'],
                [feeToSetter]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            try {
                const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                console.log('Tx: ', deployTx.hash)
                const res = await deployTx.wait(1)
                console.log('Result: ', res)
            } catch (error) {
                console.log('Error: ', error)
            }
            // compute address
            const addressPath = path.join(__dirname, `./${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`poolFactory: ${address}`)
            addressList['poolFactory'] = address

            exportData(addressList, taskArgs.addr)
        }
    )

task('deployToken', 'Use SingletonFatory to deploy Token contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const url = hre.network.config.url
            const account = hre.network.config.accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/Token.sol/Token.json').bytecode
            const tokenURI = 'https://raw.githubusercontent.com/derivable-labs/metadata/dev/token/'
            const params = ethers.utils.defaultAbiCoder.encode(
                ['string', 'address'],
                [tokenURI, utr]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            try {
                const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                console.log('Tx: ', deployTx.hash)
                const res = await deployTx.wait(1)
                console.log('Result: ', res)
            } catch (error) {
                console.log('Error: ', error)
            }
            // compute address
            const addressPath = path.join(__dirname, `./${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`token: ${address}`)
            addressList['token'] = address

            exportData(addressList, taskArgs.addr)
        }
    )

task('deployLogic', 'Use SingletonFatory to deploy Logic contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const url = hre.network.config.url
            const account = hre.network.config.accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/logics/AsymptoticPerpetual.sol/AsymptoticPerpetual.json').bytecode

            try {
                const deployTx = await contractWithSigner.deploy(byteCode, saltHex, opts)
                console.log('Tx: ', deployTx.hash)
                const res = await deployTx.wait(1)
                console.log('Result: ', res)
            } catch (error) {
                console.log('Error: ', error)
            }
            // compute address
            const addressPath = path.join(__dirname, `./${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const initCodeHash = ethers.utils.keccak256(byteCode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`logic: ${address}`)
            addressList['logic'] = address

            exportData(addressList, taskArgs.addr)
        }
    )

task('deployHelper', 'Use SingletonFatory to deploy Helper contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const url = hre.network.config.url
            const account = hre.network.config.accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/Helper.sol/Helper.json').bytecode

            const addressPath = path.join(__dirname, `./${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const tokenAddress = addressList['token']
            const params = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address'],
                [tokenAddress, weth]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )

            try {
                const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                console.log('Tx: ', deployTx.hash)
                const res = await deployTx.wait(1)
                console.log('Result: ', res)
            } catch (error) {
                console.log('Error: ', error)
            }
            // compute address
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`stateCalHelper: ${address}`)
            addressList['stateCalHelper'] = address

            exportData(addressList, taskArgs.addr)
        }
    )

task('packID', 'Pack Id to mint token')
    .addParam('id', 'Token ID')
    .setAction(
        async (taskArgs, hre) => {
            const id = packId(taskArgs.id, '0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07')
            console.log(id.toHexString())
        }
    )

function exportData(dictOutput, fileName) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, fileName + '.json'), json)
}
