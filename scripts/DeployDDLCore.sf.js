const fs = require('fs')
const path = require('path')

const opts = {
    gasLimit: 5000000
}

// mainnet arb
const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
const utr = '0x2222C5F0999E74D8D88F7bbfE300147d34c22222'
const admin = '0xFf6a4D6C03750c0d6449cCF3fF21e1E085c8f26b'
const WETH_USDC = '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443'
const WETH_USDT = '0x641c00a822e8b671738d32a431a4fb6074e5c79d'
const WETH_BTC = '0x2f5e87C9312fa29aed5c179E456625D79015299c'

// mainnet bsc
// const weth = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
// const utr = '0x2222C5F0999E74D8D88F7bbfE300147d34c22222'
// const admin = '0x5555a222c465b1873421d844e5d89ed8eb3E5555'

// testnet arb
// const weth = '0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3'
// const utr = '0xbc9a257e43f7b3b1a03aEBE909f15e95A4928834'
// const admin = '0x0af7e6C3dCEd0f86d82229Bd316d403d78F54E07'

// mainnet base
// const weth = '0x4200000000000000000000000000000000000006'
// const utr = '0x0e690e6667D48b9E61D9C6eECcb064b8Cb3e3a54'
// const admin = '0xFf6a4D6C03750c0d6449cCF3fF21e1E085c8f26b'

// testnet base
// const weth = '0x4200000000000000000000000000000000000006'
// const utr = '0xb29647dd03F9De2a9Fe9e32DF431dA5015c60353'
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
                console.log(await contractWithSigner.estimateGas.deploy(initBytecode, saltHex))
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
                console.log(await contractWithSigner.estimateGas.deploy(initBytecode, saltHex))
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
                // await contractWithSigner.callStatic.deploy(initBytecode, saltHex)
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
            const byteCode = require('../artifacts/contracts/support/TokenDescriptor.sol/TokenDescriptor.json').bytecode
            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const params = ethers.utils.defaultAbiCoder.encode(
                ['address'],
                [addressList['poolFactory']]
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
            console.log(`tokenDescriptor: ${address}`)
            addressList['tokenDescriptor'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                console.log(await contractWithSigner.estimateGas.deploy(initBytecode, saltHex))
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

task('setTokenDescriptor', 'Use SingletonFatory to deploy TokenDescriptor contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            const url = hre.network.config.url
            const account = hre.network.config.accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const TokenABI = require('../artifacts/contracts/Token.sol/Token.json').abi;
            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const contract = new ethers.Contract(addressList['token'], TokenABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)

            try {
                const deployTx = await contractWithSigner.setDescriptor(addressList['tokenDescriptor'], opts)
                console.log('Tx: ', deployTx.hash)
                const res = await deployTx.wait(1)
                console.log('Result: ', res)
            } catch (error) {
                console.log('Error: ', error)
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
                [utr, admin, ethers.constants.AddressZero]
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

task('deployPlayToken', 'Use SingletonFatory to deploy PlayDerivable contract')
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
            const byteCode = require('../artifacts/contracts/support/PlayDerivable.sol/PlayDerivable.json').bytecode

            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address'],
                [wallet.address, utr]
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
            addressList['playToken'] = address
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
                console.log(await contractWithSigner.estimateGas.deploy(initBytecode, saltHex))
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

task('deployFetcher', 'Use SingletonFatory to deploy Fetcher contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            // deploy fetchPrice factory
            const Fetcher = await ethers.getContractFactory("Fetcher")
            const estimatedGas = await ethers.provider.estimateGas(
                Fetcher.getDeployTransaction().data
            )
            console.log(estimatedGas)
            const fetcher = await Fetcher.deploy()
            await fetcher.deployed()
            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            console.log('fetchPrice: ', fetcher.address)
            addressList["fetchPrice"] = fetcher.address
            exportData(addressList, taskArgs.addr)
        }
    )

task('deployCompositeFetcher', 'Use SingletonFatory to deploy CompositeFetcher contract')
    .addParam('addr', 'The address list json file')
    .setAction(
        async (taskArgs, hre) => {
            // deploy fetchPrice factory
            const Fetcher = await ethers.getContractFactory("CompositeFetcher")
            const estimatedGas = await ethers.provider.estimateGas(
                Fetcher.getDeployTransaction(
                    WETH_USDC,
                    WETH_USDT,
                    WETH_BTC
                ).data
            )
            console.log(estimatedGas)
            const fetcher = await Fetcher.deploy(
                WETH_USDC,
                WETH_USDT,
                WETH_BTC
            )
            await fetcher.deployed()
            const addressPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            console.log('compositeFetcher: ', fetcher.address)
            addressList["compositeFetcher"] = fetcher.address
            exportData(addressList, taskArgs.addr)
        }
    )

function exportData(dictOutput, fileName) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, '/json/' + fileName + '.json'), json)
}
