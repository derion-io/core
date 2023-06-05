const fs = require('fs')
const path = require('path')
const { packId } = require("../test/shared/utilities")

task('packID', 'Pack Id to mint token')
    .addParam('id', 'Token ID')
    .setAction(
        async (taskArgs, hre) => {
            const id = packId(taskArgs.id, '0x74DF0C44Ad399Ba0301caC00EAf741C72EF90B73')
            console.log(id.toHexString())
        }
    )

task('decodeDataURI', 'Decode data uri of NFT')
    .addParam('addr', 'Json file')
    .setAction(
        async (taskArgs, hre) => {
            const dataPath = path.join(__dirname, `./json/${taskArgs.addr}.json`)
            const dataURI = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
            const json = Buffer.from(dataURI.data.substring(29), "base64").toString();
            const result = JSON.parse(json);
            console.log(result);
        }
    )

function exportData(dictOutput, fileName) {
    let json = JSON.stringify(dictOutput, null, 2)
    fs.writeFileSync(path.join(__dirname, fileName + '.json'), json)
}