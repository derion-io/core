const fs = require('fs')
const path = require('path')

const opts = {
    gasLimit: 20000000
}

// mainnet arb
const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
const utr = '0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834'
const admin = '0xFf6a4D6C03750c0d6449cCF3fF21e1E085c8f26b'

// testnet arb
// const weth = '0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3'
// const utr = '0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834'
// const admin = '0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07'

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

            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address'],
                [addressList['logic']]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            // compute address
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`poolFactory: ${address}`)
            addressList['poolFactory'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                await contractWithSigner.callStatic.deploy(initBytecode, saltHex, opts)
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait(1)
                    console.log('Result: ', res)
                } catch (error) {
                    console.log('Error: ', error)
                }
                exportData(addressList, taskArgs.addr)
            } else {
                return
            }
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
            const byteCode = require('../artifacts/contracts/PoolLogic.sol/PoolLogic.json').bytecode

            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const feeRate = 5

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address', 'uint256'],
                [addressList['token'], addressList["feeReceiver"], feeRate]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            // compute address
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`logic: ${address}`)
            addressList['logic'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                await contractWithSigner.callStatic.deploy(initBytecode, saltHex, opts)
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait(1)
                    console.log('Result: ', res)
                } catch (error) {
                    console.log('Error: ', error)
                }
                exportData(addressList, taskArgs.addr)
            } else {
                return
            }
        }
    )

task('deployFeeReceiver', 'Use SingletonFatory to deploy FeeReceiver contract')
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
            const byteCode = require('../artifacts/contracts/support/FeeReceiver.sol/FeeReceiver.json').bytecode
            const params = ethers.utils.defaultAbiCoder.encode(
                ['address'],
                [admin]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            // compute address
            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`feeReceiver: ${address}`)
            addressList['feeReceiver'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                await contractWithSigner.callStatic.deploy(initBytecode, saltHex, opts)
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait(1)
                    console.log('Result: ', res)
                } catch (error) {
                    console.log('Error: ', error)
                }
                exportData(addressList, taskArgs.addr)
            } else {
                return
            }
        }
    )

task('deployTokenDescriptor', 'Use SingletonFatory to deploy TokenDescriptor contract')
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
            const initBytecode = require('../artifacts/contracts/support/TokenDescriptor.sol/TokenDescriptor.json').bytecode
            // compute address
            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`tokenDescriptor: ${address}`)
            addressList['tokenDescriptor'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                await contractWithSigner.callStatic.deploy(initBytecode, saltHex, opts)
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait(1)
                    console.log('Result: ', res)
                } catch (error) {
                    console.log('Error: ', error)
                }
                exportData(addressList, taskArgs.addr)
            } else {
                return
            }
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

            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address', 'address'],
                [utr, admin, addressList['tokenDescriptor']]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            // compute address
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`token: ${address}`)
            addressList['token'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait(1)
                    console.log('Result: ', res)
                } catch (error) {
                    console.log('Error: ', error)
                }
                exportData(addressList, taskArgs.addr)
            } else {
                return
            }
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
            const byteCode = require('../artifacts/contracts/support/Helper.sol/Helper.json').bytecode

            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
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
            // compute address
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32),
                initCodeHash,
            )
            console.log(`stateCalHelper: ${address}`)
            addressList['stateCalHelper'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                // await contractWithSigner.callStatic.deploy(initBytecode, saltHex, opts)
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, opts)
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait(1)
                    console.log('Result: ', res)
                } catch (error) {
                    console.log('Error: ', error)
                }
                exportData(addressList, taskArgs.addr)
            } else {
                return
            }
        }
    )

function exportData(dictOutput, fileName) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, '/json/' + fileName + '.json'), json)
}
