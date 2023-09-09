const { ethers } = require("hardhat")
const fs = require('fs')
const path = require('path')
const { bn } = require("../test/shared/utilities")

const pe = (x) => ethers.utils.parseEther(String(x))

const opts = {
    gasLimit: 3000000
}

const PAYMENT = 0;
const SIDE_R = 0x00
const SIDE_A = 0x10
const SIDE_B = 0x20
const SIDE_C = 0x30

async function main() {

    const url = hre.network.config.url
    const account = hre.network.config.accounts[0]
    // Connect to the network
    const provider = new ethers.providers.JsonRpcProvider(url)
    const wallet = new ethers.Wallet(account, provider)

    const addressPath = path.join(__dirname, `./json/${process.env.addr}.json`)
    const addressList = JSON.parse(fs.readFileSync(addressPath, 'utf8'))
    const poolAddress = addressList["pool-GOLD^4-1"]
    const wethAddress = '0x4200000000000000000000000000000000000006'

    const helperABI = require("../artifacts/contracts/support/Helper.sol/Helper.json").abi
    const stateCalHelper = new ethers.Contract(addressList["stateCalHelper"], helperABI, provider)

    const utrABI = require("./abi/UniversalTokenRouter.json").abi
    const utr = new ethers.Contract(addressList["utr"], utrABI, provider)

    const utrWithSigner = utr.connect(wallet)

    try {
        const tx = await utrWithSigner.exec([], [{
            inputs: [{
                mode: PAYMENT,
                eip: 20,
                token: wethAddress,
                id: 0,
                amountIn: pe(0.00001),
                recipient: poolAddress,
            }],
            code: stateCalHelper.address,
            data: (await stateCalHelper.populateTransaction.swap({
                sideIn: SIDE_R,
                poolIn: poolAddress,
                sideOut: SIDE_C,
                poolOut: poolAddress,
                amountIn: pe(0.00001),
                payer: wallet.address,
                recipient: wallet.address,
                INDEX_R: 0
            })).data,
        }], opts)
        console.log('Tx: ', tx.hash)
        const res = await tx.wait(1)
        console.log('Result: ', res)
    } catch (error) {
        console.log('Error: ', error)
    }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})