const fs = require('fs')
const path = require('path')

const opts = {
    gasLimit: 5000000*4,
}

const admin = '0x5555a222c465b1873421d844e5d89ed8eb3E5555'

const singletonFactoryAddress = '0xce0042B868300000d44A59004Da54A005ffdcf9f'

task('deployDeployer', 'Use SingletonFatory to deploy PoolDeployer contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { url, accounts, weth } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/support/PoolDeployer.sol/PoolDeployer.json').bytecode

            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address'],
                [weth, addressList['logic']]
            )
            const initBytecode = ethers.utils.solidityPack(
                ['bytes', 'bytes'],
                [byteCode, params]
            )
            // compute address
            const initCodeHash = ethers.utils.keccak256(initBytecode)
            const address = ethers.utils.getCreate2Address(
                singletonFactoryAddress,
                saltHex,
                initCodeHash,
            )
            console.log(`poolDeployer: ${address}`)
            addressList['poolDeployer'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                const estimatedGas = await contractWithSigner.estimateGas.deploy(initBytecode, saltHex)
                console.log('Estimated Gas: ', estimatedGas.toNumber())
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('deployLogic', 'Use SingletonFatory to deploy Logic contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { url, accounts } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/PoolLogic.sol/PoolLogic.json').bytecode

            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
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
                const gasLimit = (await contractWithSigner.estimateGas.deploy(initBytecode, saltHex)) << 1
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasLimit, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('deployFeeReceiver', 'Use SingletonFatory to deploy FeeReceiver contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { url, accounts } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
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
            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
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
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('deployTokenDescriptor', 'Use SingletonFatory to deploy TokenDescriptor contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { url, accounts } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/support/TokenDescriptor.sol/TokenDescriptor.json').bytecode
            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
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
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('setDescriptor', 'Use SingletonFatory to deploy TokenDescriptor contract')
    .setAction(
        async (taskArgs, hre) => {
            const { url, accounts } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const TokenABI = require('../artifacts/contracts/Token.sol/Token.json').abi;
            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            const contract = new ethers.Contract(addressList['token'], TokenABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)

            try {
                const deployTx = await contractWithSigner.setDescriptor(addressList['tokenDescriptor'], { ...opts, gasPrice })
                console.log('Tx: ', deployTx.hash)
                const res = await deployTx.wait()
                console.log('Gas Used:', res.gasUsed.toNumber())
            } catch (error) {
                console.log('Error: ', error.error ?? error)
            }
        }
    )

task('deployToken', 'Use SingletonFatory to deploy Token contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { url, accounts, utr } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/Token.sol/Token.json').bytecode

            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
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
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('deployPlayToken', 'Use SingletonFatory to deploy PlayDerivable contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { accounts, url } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/support/PlayDerivable.sol/PlayDerivable.json').bytecode

            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

            const { AddressZero } = ethers.constants

            const params = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address'],
                [AddressZero, utr]
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
            console.log(`PlayDerivable: ${address}`)
            addressList['playToken'] = address
            const byteCodeOfFinalAddress = await provider.getCode(address)
            if (byteCodeOfFinalAddress == '0x') {
                try {
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('mintPlayToken', 'Mint PlayDerivable token')
    .addParam('to', 'The recipient address')
    .addParam('amount', 'The amount of 1e18 token')
    .setAction(
        async (taskArgs, hre) => {
            const { accounts, url } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const wallet = new ethers.Wallet(account, provider)
            const abi = require('../artifacts/contracts/support/PlayDerivable.sol/PlayDerivable.json').abi

            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))

            const playToken = (new ethers.Contract(addressList.playToken, abi, provider)).connect(wallet)
            try {
                const tx = await playToken.mint(
                    taskArgs.to,
                    ethers.utils.parseEther(taskArgs.amount),
                    { gasPrice },
                )
                const res = await tx.wait()
                console.log('Gas Used:', res.gasUsed.toNumber())
            } catch (err) {
                console.error(err.error ?? err)
            }
        }
    )

task('deployHelper', 'Use SingletonFatory to deploy Helper contract')
    .setAction(
        async (taskArgs, hre) => {
            const salt = 0
            const saltHex = ethers.utils.hexZeroPad(ethers.utils.hexlify(salt), 32)
            const SingletonFactoryABI = require('./abi/SingletonFactoryABI.json')
            const { url, accounts, weth } = hre.network.config
            const gasPrice = hre.network.config.gasPrice != 'auto' ? hre.network.config.gasPrice : undefined
            const account = accounts[0]
            // Connect to the network
            const provider = new ethers.providers.JsonRpcProvider(url)
            const contract = new ethers.Contract(singletonFactoryAddress, SingletonFactoryABI, provider)
            const wallet = new ethers.Wallet(account, provider)
            const contractWithSigner = contract.connect(wallet)
            const byteCode = require('../artifacts/contracts/support/Helper.sol/Helper.json').bytecode

            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
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
                    const deployTx = await contractWithSigner.deploy(initBytecode, saltHex, { ...opts, gasPrice })
                    console.log('Tx: ', deployTx.hash)
                    const res = await deployTx.wait()
                    console.log('Gas Used:', res.gasUsed.toNumber())
                } catch (error) {
                    console.log('Error: ', error.error ?? error)
                }
                exportData(addressList, hre.network.name)
            } else {
                return
            }
        }
    )

task('deployFetcher', 'Use SingletonFatory to deploy Fetcher contract')
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
            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            console.log('fetchPrice: ', fetcher.address)
            addressList["fetchPrice"] = fetcher.address
            exportData(addressList, hre.network.name)
        }
    )

task('deployCompositeFetcher', 'Use SingletonFatory to deploy CompositeFetcher contract')
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
            const addressPath = path.join(__dirname, `./json/${hre.network.name}.json`)
            const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
            console.log('compositeFetcher: ', fetcher.address)
            addressList["compositeFetcher"] = fetcher.address
            exportData(addressList, hre.network.name)
        }
    )

function exportData(dictOutput, fileName) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, '/json/' + fileName + '.json'), json)
}
